#include <Arduino.h>
#include <ESP32Time.h>
#include <FastLED.h>
#include <SD_MMC.h>
#include <SparkFun_u-blox_GNSS_v3.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <dlflib/dlf_logger.h>
#include <driver/sdmmc_host.h>
#include <esp_log.h>

// Configuration
const int SERIAL_BAUD_RATE{115200};
const int LOGGER_RUN_INTERVAL_S{0};
const bool LOGGER_MARK_AFTER_UPLOAD{true};
const bool LOGGER_DELETE_AFTER_UPLOAD{false};
const int LOGGER_PARTIAL_RUN_UPLOAD_INTERVAL_SECS{0};
const int WIFI_RECONFIG_BUTTON_HOLD_TIME_MS{2000};

// Testing overrides
const bool WAIT_FOR_VALID_TIME{true};
const bool USE_LEGACY_GPIO_CONFIG{false};
const bool USB_POWER_OVERRIDE{true};
const bool USB_POWER_OVERRIDE_VALUE{true};
const int GPS_PRINT_INTERVAL_MS{1000};

// Pin Definitions
const gpio_num_t PIN_USB_POWER{GPIO_NUM_13};
const gpio_num_t PIN_SLEEP_BUTTON{GPIO_NUM_0};
const gpio_num_t PIN_SD_CLK{GPIO_NUM_45};  // Clock
const gpio_num_t PIN_SD_CMD{GPIO_NUM_40};  // Command
const gpio_num_t PIN_SD_D0{GPIO_NUM_39};   // Data 0
const gpio_num_t PIN_SD_D1{GPIO_NUM_38};   // Data 1 (for 4-bit mode)
const gpio_num_t PIN_SD_D2{GPIO_NUM_41};   // Data 2 (for 4-bit mode)
const gpio_num_t PIN_SD_D3{GPIO_NUM_42};   // Data 3 (for 4-bit mode)

// GPS Power and Control Pins (TESTED AND WORKING)
const gpio_num_t PIN_GPS_ENABLE{
    GPIO_NUM_3};  // Power enable for GPS module (same as SD card enable)
const gpio_num_t PIN_GPS_WAKE{
    GPIO_NUM_5};  // Wake signal for SAM-M10Q (set HIGH)

// GPS UART Pins (TESTED AND WORKING - RX/TX swapped from schematic)
const gpio_num_t PIN_GPS_TX{GPIO_NUM_36};  // ESP TX -> GPS RX (swapped)
const gpio_num_t PIN_GPS_RX{GPIO_NUM_37};  // ESP RX <- GPS TX (swapped)

// LED Configuration
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

// GPS Configuration
const int GPS_BAUD_RATE{38400};          // SAM-M10Q default
const uint32_t GPS_UPDATE_RATE_MS{100};  // 10Hz update rate
#define mySerial Serial1                 // GPS Serial port

// WiFi Configuration
const char* WIFI_CONFIG_AP_NAME{"OASDataLogger"};
const int WIFI_RECONNECT_BACKOFF_MS{2000};
const int WIFI_MAX_BACKOFF_MS{30000};
static volatile bool wifiConnecting = false;
static uint32_t wifiReconnectBackoff = WIFI_RECONNECT_BACKOFF_MS;

// TODO: Be able to configure upload endpoint in Access Point mode
const char* UPLOAD_ENDPOINT{"https://oas-data-logger.vercel.app/api/upload/%s"};

// State Machine States
enum class SystemState {
  INIT,
  WAIT_SD,
  WAIT_WIFI,
  WAIT_GPS,
  WAIT_TIME,
  RUNNING,
  OFFLOAD,
  ERROR,
  SLEEP
};

// Error Types for LED Patterns
enum class ErrorType {
  NONE,
  SD_INIT_FAILED,
  GPS_NOT_RESPONDING,
  WIFI_CONFIG_FAILED,
  LOGGER_INIT_FAILED
};

// Global Objects
CRGB leds[NUM_LEDS];
SFE_UBLOX_GNSS_SERIAL myGNSS;  // u-blox GNSS object
ESP32Time rtc;
WiFiManager wifiManager;
dlf::CSCLogger logger{SD_MMC};
TaskHandle_t xGPS_Handle = NULL;

// State Machine Variables
SystemState currentState = SystemState::INIT;
ErrorType currentError = ErrorType::NONE;
bool offloadMode = false;
bool gpsEnabled = false;
dlf::run_handle_t runHandle{0};

// GPS Time tracking (separate from position data)
bool gpsTimeValid = false;
time_t gpsEpoch = 0;
uint8_t gpsFixType = 0;

// Timing Variables
unsigned long lastLoggerStartRunMillis{0};
unsigned long lastLedToggleMillis{0};
unsigned long lastGpsPrintMillis{0};
bool ledToggleState = false;

// GPS Data Structure with Mutex Protection
struct GpsData {
  double lat;
  double lng;
  double alt;
  uint32_t satellites;
};

GpsData gpsData{0.0, 0.0, 0.0, 0};
SemaphoreHandle_t gpsDataMutex;

// Function Prototypes
void initializeLeds();
void updateLedPattern();
void transitionToState(SystemState newState);
void handleInitState();
void handleWaitSdState();
void handleWaitWifiState();
void handleWaitGpsState();
void handleWaitTimeState();
void handleRunningState();
void handleOffloadState();
void handleErrorState();
void handleSleepState();
bool hasUsbPower();
bool wifiCredentialsExist();
void enableGps();
void disableGps();
String getDeviceUid();
void initializeLogger();
void startLoggerRun();
void gpsTask(void* args);
void sleepMonitorTask(void* args);
void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  // Initialize LED first for status indication
  initializeLeds();

  // Create mutex for GPS data protection
  gpsDataMutex = xSemaphoreCreateMutex();
  if (gpsDataMutex == NULL) {
    currentError = ErrorType::LOGGER_INIT_FAILED;
    transitionToState(SystemState::ERROR);
    return;
  }

  // Configure pins
  pinMode(PIN_USB_POWER, INPUT_PULLDOWN);
  pinMode(PIN_SLEEP_BUTTON, INPUT_PULLUP);

  // CRITICAL: GPIO 3 is a strapping pin - configure it after boot delay
  // This pin powers BOTH SD card and GPS module
  // We need SD card active from the start, GPS will be enabled later
  vTaskDelay(pdMS_TO_TICKS(
      1000));  // Wait for boot to complete before configuring GPIO 3

  pinMode(PIN_GPS_ENABLE, OUTPUT);
  pinMode(PIN_GPS_WAKE, OUTPUT);
  digitalWrite(PIN_GPS_ENABLE,
               HIGH);  // Enable power for SD card (shared with GPS)
  digitalWrite(PIN_GPS_WAKE, LOW);  // GPS wake signal LOW (GPS not active yet)

  vTaskDelay(pdMS_TO_TICKS(500));  // Give SD card time to power up

  // Start sleep monitor task
  xTaskCreate(sleepMonitorTask, "sleep_monitor", 4096, NULL, 5, NULL);

  // Determine initial mode based on USB power
  offloadMode = !hasUsbPower();

  // Start state machine
  transitionToState(SystemState::INIT);
}

void loop() {
  // Update LED pattern based on current state
  updateLedPattern();

  // State machine logic
  switch (currentState) {
    case SystemState::INIT:
      handleInitState();
      break;
    case SystemState::WAIT_SD:
      handleWaitSdState();
      break;
    case SystemState::WAIT_WIFI:
      handleWaitWifiState();
      break;
    case SystemState::WAIT_GPS:
      handleWaitGpsState();
      break;
    case SystemState::WAIT_TIME:
      handleWaitTimeState();
      break;
    case SystemState::RUNNING:
      handleRunningState();
      break;
    case SystemState::OFFLOAD:
      handleOffloadState();
      break;
    case SystemState::ERROR:
      handleErrorState();
      break;
    case SystemState::SLEEP:
      handleSleepState();
      break;
  }

  vTaskDelay(pdMS_TO_TICKS(10));
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      Serial.println("[WiFi] STA started");
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("[WiFi] Connected to AP");
      wifiConnecting = false;
      wifiReconnectBackoff = WIFI_RECONNECT_BACKOFF_MS;  // Reset backoff
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.print("[WiFi] Got IP: ");
      Serial.println(WiFi.localIP());
      wifiConnecting = false;
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.printf("[WiFi] Disconnected, reason: %d\n",
                    info.wifi_sta_disconnected.reason);

      // Handle auth failures differently
      if (info.wifi_sta_disconnected.reason == 201) {  // AUTH_FAIL
        Serial.println("[WiFi] Authentication failed - check credentials");
        // Don't auto-reconnect on auth failure
        wifiConnecting = false;
      } else {
        // For other disconnection reasons, use backoff and reconnect
        vTaskDelay(pdMS_TO_TICKS(wifiReconnectBackoff));
        wifiReconnectBackoff =
            min<uint32_t>(wifiReconnectBackoff * 2, WIFI_MAX_BACKOFF_MS);

        if (!wifiConnecting) {
          WiFi.reconnect();
          wifiConnecting = true;
        }
      }
      break;
    default:
      break;
  }
}

void initializeLeds() {
  FastLED.addLeds<LED_TYPE, LED_PIN, LED_COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(LED_BRIGHTNESS);
  FastLED.showColor(CRGB::White);
}

void updateLedPattern() {
  unsigned long currentMillis = millis();

  switch (currentState) {
    case SystemState::INIT:
      FastLED.showColor(CRGB::White);
      break;

    case SystemState::WAIT_SD:
    case SystemState::WAIT_WIFI:
    case SystemState::WAIT_GPS:
    case SystemState::WAIT_TIME:
      // Yellow blinking for waiting states
      if (currentMillis - lastLedToggleMillis > 500) {
        lastLedToggleMillis = currentMillis;
        ledToggleState = !ledToggleState;
        FastLED.showColor(ledToggleState ? CRGB::Yellow : CRGB::Black);
      }
      break;

    case SystemState::RUNNING:
      FastLED.showColor(CRGB::Green);
      break;

    case SystemState::OFFLOAD:
      FastLED.showColor(CRGB::Blue);
      break;

    case SystemState::ERROR:
      // Different blink patterns for different errors
      uint32_t blinkInterval;
      switch (currentError) {
        case ErrorType::SD_INIT_FAILED:
          blinkInterval = 200;  // Fast blink
          break;
        case ErrorType::GPS_NOT_RESPONDING:
          blinkInterval = 400;  // Medium blink
          break;
        case ErrorType::WIFI_CONFIG_FAILED:
          blinkInterval = 800;  // Very slow blink
          break;
        default:
          blinkInterval = 1000;  // Default slow blink
          break;
      }

      if (currentMillis - lastLedToggleMillis > blinkInterval) {
        lastLedToggleMillis = currentMillis;
        ledToggleState = !ledToggleState;
        FastLED.showColor(ledToggleState ? CRGB::Red : CRGB::Black);
      }
      break;

    case SystemState::SLEEP:
      FastLED.showColor(CRGB::Black);
      break;
  }
}

void transitionToState(SystemState newState) {
  Serial.printf("State transition: %d -> %d\n", (int)currentState,
                (int)newState);
  currentState = newState;

  // Reset LED toggle state on transition
  ledToggleState = false;
  lastLedToggleMillis = millis();
}

void handleInitState() {
  if (offloadMode) {
    transitionToState(SystemState::WAIT_SD);
  } else {
    transitionToState(SystemState::WAIT_SD);
  }
}

void handleWaitSdState() {
  Serial.println("Initializing SDIO for SD card...");

  // Configure the pins for SDIO
  if (!SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0, PIN_SD_D1, PIN_SD_D2,
                      PIN_SD_D3)) {
    Serial.println("Pin configuration failed!");
    currentError = ErrorType::SD_INIT_FAILED;
    transitionToState(SystemState::ERROR);
    return;
  }

  // Try 1-bit mode first (more reliable)
  Serial.println("Trying 1-bit mode...");
  if (SD_MMC.begin("/sdcard", true)) {  // true = use 1-bit mode
    Serial.println("SD card connected via SDIO (1-bit mode)");

    // Optionally try 4-bit mode
    SD_MMC.end();
    delay(100);
    Serial.println("Now trying 4-bit mode...");
    if (SD_MMC.begin("/sdcard", true, false,
                     SDMMC_FREQ_DEFAULT)) {  // false = 4-bit mode
      Serial.println("SD card connected via SDIO (4-bit mode)");
    } else {
      Serial.println("4-bit failed, falling back to 1-bit");
      SD_MMC.begin("/sdcard", true);
    }
    transitionToState(SystemState::WAIT_WIFI);
  } else {
    Serial.println("SD card initialization failed even in 1-bit mode");
    currentError = ErrorType::SD_INIT_FAILED;
    transitionToState(SystemState::ERROR);
  }
}

void handleWaitWifiState() {
  Serial.println("Initializing WiFi (STA)...");

  // Set WiFi mode and register event handler
  WiFi.mode(WIFI_STA);
  WiFi.onEvent(onWiFiEvent);
  WiFi.setAutoReconnect(false);  // We'll handle reconnection ourselves

  // Check if we have saved credentials
  if (WiFi.SSID().length() == 0) {
    Serial.println("No WiFi credentials saved. Starting WiFi Manager...");
    wifiManager.autoConnect(WIFI_CONFIG_AP_NAME);
  } else {
    Serial.printf("Connecting to saved WiFi: %s\n", WiFi.SSID().c_str());
    WiFi.begin();  // Use saved credentials
    wifiConnecting = true;
  }

  // Wait up to 15 seconds for connection
  unsigned long startTime = millis();
  while (wifiConnecting && (millis() - startTime < 15000)) {
    vTaskDelay(pdMS_TO_TICKS(100));
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected successfully");
  } else {
    Serial.println("WiFi not connected; continuing without network.");
  }

  transitionToState(SystemState::WAIT_GPS);
}

void handleWaitGpsState() {
  if (offloadMode) {
    // Skip GPS in offload mode
    transitionToState(SystemState::OFFLOAD);
    return;
  }

  enableGps();

  if (gpsEnabled) {
    // Start GPS task
    xTaskCreate(gpsTask, "gps", 4096, NULL, 5, &xGPS_Handle);
    transitionToState(SystemState::WAIT_TIME);
  }
}

void handleWaitTimeState() {
  // Check if we have valid time AND a GPS fix
  if (gpsTimeValid && gpsEpoch >= 1735689600) {  // 2025-01-01 UTC
    // Set system time for TLS operations
    struct timeval tv;
    tv.tv_sec = gpsEpoch;
    tv.tv_usec = 0;
    settimeofday(&tv, nullptr);

    // Also set the RTC
    rtc.setTime(gpsEpoch);

    Serial.printf("Valid time received: %ld\n", gpsEpoch);

    // Initialize logger and start run
    initializeLogger();
    startLoggerRun();
    transitionToState(SystemState::RUNNING);
  } else {
    // Print waiting status every 5 seconds
    static unsigned long lastPrintTime = 0;
    if (millis() - lastPrintTime > 5000) {
      lastPrintTime = millis();
      Serial.println("Waiting for valid GPS time...");
    }
  }
}

void handleRunningState() {
  // GPS printing logic with enhanced diagnostics
  // Only print if GPS is still enabled (prevents printing during shutdown)
  if (gpsEnabled && millis() - lastGpsPrintMillis > GPS_PRINT_INTERVAL_MS) {
    lastGpsPrintMillis = millis();

    // Try to get GPS data with mutex protection
    if (xSemaphoreTake(gpsDataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      Serial.printf(
          "[GPS] Lat: %.6f, Lng: %.6f, Alt: %.1fm, Sats: %d, Fix: %d\n",
          gpsData.lat, gpsData.lng, gpsData.alt, gpsData.satellites,
          gpsFixType);
      Serial.printf("[DIAG] RunHandle: %d, Uptime: %lu ms\n", runHandle,
                    millis());
      xSemaphoreGive(gpsDataMutex);
    }
  }

  // Run interval logic - only if LOGGER_RUN_INTERVAL_S > 0
  if (runHandle && LOGGER_RUN_INTERVAL_S > 0 &&
      millis() - lastLoggerStartRunMillis > LOGGER_RUN_INTERVAL_S * 1000) {
    startLoggerRun();
  }
}

void handleOffloadState() {
  // Give logger sync/upload time to start
  vTaskDelay(pdMS_TO_TICKS(100));

  logger.waitForSyncCompletion();

  // After sync completion, either sleep or continue
  transitionToState(SystemState::SLEEP);
}

void handleErrorState() {
  // Error state is handled by LED pattern
  Serial.printf("System in ERROR state. Error type: %d\n", (int)currentError);

  // For critical errors, restart after 10 seconds
  static unsigned long errorStartMillis = millis();
  if (millis() - errorStartMillis > 10000) {
    ESP.restart();
  }
}

void handleSleepState() {
  Serial.println("Entering deep sleep...");

  // Stop all tasks
  disableGps();

  // Turn off LED
  FastLED.showColor(CRGB::Black);

  // Configure wake on USB power only if unconnected, else wake on reset
  if (!hasUsbPower()) {
    esp_sleep_enable_ext0_wakeup(PIN_USB_POWER, 1);
  } else {
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  }

  // Enter deep sleep
  esp_deep_sleep_start();
}

bool hasUsbPower() {
  if (USB_POWER_OVERRIDE) {
    return USB_POWER_OVERRIDE_VALUE;
  }
  return digitalRead(PIN_USB_POWER);
}

bool wifiCredentialsExist() { return WiFi.SSID().length() > 0; }

void enableGps() {
  if (gpsEnabled) return;
  Serial.println("Enabling GPS...");

  // Power cycle the GPS module (TESTED AND WORKING)
  // Note: PIN_GPS_ENABLE is already HIGH from setup() (shared with SD card)
  // We only need to cycle the WAKE signal
  digitalWrite(PIN_GPS_WAKE, LOW);
  vTaskDelay(pdMS_TO_TICKS(100));
  digitalWrite(PIN_GPS_WAKE, HIGH);  // Wake signal must be HIGH
  vTaskDelay(pdMS_TO_TICKS(1000));   // GPS needs time to boot

  // Bind UART to the selected pins
  mySerial.end();
  mySerial.begin(38400, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  bool connected = myGNSS.begin(mySerial);

  if (!connected) {
    mySerial.updateBaudRate(9600);
    connected = myGNSS.begin(mySerial);
    if (connected) {
      myGNSS.setSerialRate(38400);
      vTaskDelay(pdMS_TO_TICKS(100));
      mySerial.updateBaudRate(38400);
    }
  }
  if (!connected) {
    Serial.println("GPS not responding");
    currentError = ErrorType::GPS_NOT_RESPONDING;
    transitionToState(SystemState::ERROR);
    return;
  }

  myGNSS.setUART1Output(COM_TYPE_UBX);
  myGNSS.setNavigationFrequency(10);
  myGNSS.setAutoPVT(true);
  myGNSS.saveConfiguration();

  gpsEnabled = true;
  Serial.println("GPS enabled");
}

void gpsTask(void* args) {
  Serial.println("[GPS Task] Started");

  while (true) {
    // Request PVT data - returns true when new data is available
    if (myGNSS.getPVT()) {
      // Get fix type and satellite count (not protected by mutex)
      gpsFixType = myGNSS.getFixType();

      // Update GPS data with mutex protection
      if (xSemaphoreTake(gpsDataMutex, portMAX_DELAY) == pdTRUE) {
        // Get satellite count
        gpsData.satellites = myGNSS.getSIV();

        // Only update position if we have a valid fix
        if (gpsFixType >= 2 && !myGNSS.getInvalidLlh()) {
          gpsData.lat =
              myGNSS.getLatitude() / 10000000.0;  // Convert from degrees * 10^7
          gpsData.lng = myGNSS.getLongitude() /
                        10000000.0;  // Convert from degrees * 10^7
          gpsData.alt =
              myGNSS.getAltitudeMSL() / 1000.0;  // Convert from mm to meters
        }

        xSemaphoreGive(gpsDataMutex);
      }

      // Check time validity more strictly (outside mutex protection)
      // Only consider time valid if we have a fix AND valid date/time
      if (gpsFixType >= 2 && myGNSS.getDateValid() && myGNSS.getTimeValid() &&
          myGNSS.getYear() >= 2025 && myGNSS.getMonth() >= 1 &&
          myGNSS.getMonth() <= 12 && myGNSS.getDay() >= 1 &&
          myGNSS.getDay() <= 31) {
        struct tm t = {};
        t.tm_year = myGNSS.getYear() - 1900;
        t.tm_mon = myGNSS.getMonth() - 1;
        t.tm_mday = myGNSS.getDay();
        t.tm_hour = myGNSS.getHour();
        t.tm_min = myGNSS.getMinute();
        t.tm_sec = myGNSS.getSecond();

        time_t newEpoch = mktime(&t);

        // Additional sanity check
        if (newEpoch >= 1735689600) {  // 2025-01-01 UTC
          gpsEpoch = newEpoch;
          gpsTimeValid = true;
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(GPS_UPDATE_RATE_MS));
  }
}

void disableGps() {
  if (!gpsEnabled) {
    return;
  }

  Serial.println("Disabling GPS...");

  // Delete GPS task if it exists
  if (xGPS_Handle != NULL) {
    Serial.println("[GPS] Deleting GPS task...");
    vTaskDelete(xGPS_Handle);
    xGPS_Handle = NULL;
  }

  // Turn off GPS wake signal
  // NOTE: We do NOT turn off PIN_GPS_ENABLE because it's shared with SD card!
  // SD card needs to remain powered for data logging
  digitalWrite(PIN_GPS_WAKE, LOW);

  // Close UART
  mySerial.end();

  gpsEnabled = false;
  Serial.println("GPS disabled");
}

String getDeviceUid() {
  uint64_t raw = ESP.getEfuseMac();
  char id[13];
  sprintf(id, "%012llX", raw);
  return id;
}

void initializeLogger() {
  Serial.println("Initializing logger...");

  auto satellitesLogInterval{std::chrono::seconds(5)};
  POLL(logger, gpsData.satellites, satellitesLogInterval, gpsDataMutex);

  auto gpsDataLogInterval{std::chrono::seconds(1)};
  POLL(logger, gpsData.lat, gpsDataLogInterval, gpsDataMutex);
  POLL(logger, gpsData.lng, gpsDataLogInterval, gpsDataMutex);
  POLL(logger, gpsData.alt, gpsDataLogInterval, gpsDataMutex);

  dlf::components::UploaderComponent::Options options;
  options.markAfterUpload = LOGGER_MARK_AFTER_UPLOAD;
  options.deleteAfterUpload = LOGGER_DELETE_AFTER_UPLOAD;
  options.partialRunUploadIntervalSecs =
      LOGGER_PARTIAL_RUN_UPLOAD_INTERVAL_SECS;
  logger.syncTo(UPLOAD_ENDPOINT, getDeviceUid(), options).begin();

  Serial.println("Logger initialized");
}

void startLoggerRun() {
  if (runHandle) {
    logger.stopRun(runHandle);
  }

  double m = 0;
  runHandle = logger.startRun(Encodable(m, "double"));
  lastLoggerStartRunMillis = millis();
}

void sleepCleanup() {
  disableGps();
  vTaskDelay(pdMS_TO_TICKS(100));
  if (runHandle) {
    logger.stopRun(runHandle);
    runHandle = 0;
  }
}

void sleepMonitorTask(void* args) {
  vTaskDelay(pdMS_TO_TICKS(5000));

  bool usbSleepTriggered = false;

  while (true) {
    // Only check sleep conditions if we're in RUNNING state
    if (currentState == SystemState::RUNNING) {
      // Check sleep button
      bool sleepButtonPressed = !digitalRead(PIN_SLEEP_BUTTON);

      if (sleepButtonPressed) {
        unsigned long start = millis();

        while (!digitalRead(PIN_SLEEP_BUTTON)) {
          if (millis() - start >= WIFI_RECONFIG_BUTTON_HOLD_TIME_MS) {
            Serial.println(
                "[WiFi Reconfiguration] WiFi reconfiguration mode entered...");

            sleepCleanup();
            vTaskDelay(pdMS_TO_TICKS(100));
            logger.waitForSyncCompletion();
            Serial.println("[WiFi Reconfiguration] Resetting WiFiManager...");
            wifiManager.resetSettings();  // uses vTaskDelay internally
            Serial.println(
                "[WiFi Reconfiguration] Rebooting device into AP mode...");
            ESP.restart();  // soft reboot
            break;
          }
          yield();
        }

        if (millis() - start < WIFI_RECONFIG_BUTTON_HOLD_TIME_MS) {
          sleepCleanup();
          transitionToState(SystemState::OFFLOAD);
          break;
        }
      }
    }

    // Check USB power for sleep trigger
    bool usbSleep = !offloadMode && !hasUsbPower();
    if (usbSleep && usbSleepTriggered) {
      sleepCleanup();
      transitionToState(SystemState::OFFLOAD);
      break;
    } else if (usbSleep) {
      usbSleepTriggered = true;
    } else {
      usbSleepTriggered = false;
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
  }

  // Task will be deleted when system enters sleep
  vTaskDelete(NULL);
}
