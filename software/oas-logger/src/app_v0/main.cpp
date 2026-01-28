/**
 * Usage instructions:
 *
 * The device will automatically power up and begin logging a new run whenever
 * power is applied through USB. It will automatically and safely end the
 * current run and enter sleep mode when power is removed.
 *
 * To enter sleep mode (and thus end logging for the current run) at any time,
 * press the SLEEP button. To turn the device on again, press the RESET button.
 *
 * To enter offload mode (which connects to Wi-Fi and uploads available run
 * data, when there is no USB power), press the RESET button.
 */

#include <AdvancedLogger.h>
#include <Arduino.h>
#include <ESP32Time.h>
#include <FS.h>
#include <FastLED.h>
#include <SD.h>
#include <SPI.h>
#include <TinyGPS++.h>
#include <WiFiManager.h>
#include <Wire.h>
#include <dlflib/dlf_logger.h>

#include "DeviceAuth.h"
#include "memory_monitor/memory_monitor.h"
#include "ota_updater/ota_updater.h"

// Configuration
const unsigned long SERIAL_BAUD_RATE{115200};
// Every X seconds, start a new run. Negative or zero means do not cut a run
// (except when going to sleep).
const int LOGGER_RUN_INTERVAL_S{0};  // <= 0 means disabled
const bool LOGGER_MARK_AFTER_UPLOAD{true};
const bool LOGGER_DELETE_AFTER_UPLOAD{false};
const int LOGGER_PARTIAL_RUN_UPLOAD_INTERVAL_SECS{0};  // <= 0 means disabled
const int WIFI_RECONFIG_BUTTON_HOLD_TIME_MS{2000};
const bool ENABLE_OTA_UPDATE{false};

// Testing overrides
const bool WAIT_FOR_VALID_TIME{true};
const bool USE_LEGACY_GPIO_CONFIG{false};
const bool USB_POWER_OVERRIDE{false};
const bool USB_POWER_OVERRIDE_VALUE{false};
const int GPS_PRINT_INTERVAL_SECS{0};         // <= 0 means disabled
const int PRINT_HEAP_USAGE_INTERVAL_SECS{0};  // <= 0 means disabled

// Input pin definitions
// Note: GPIO13 is also shared with the built-in LED (not the NeoPixel LED). The
// built-in LED is used as a USB power indicator.
const gpio_num_t PIN_USB_POWER{GPIO_NUM_13};
const gpio_num_t PIN_SLEEP_BUTTON{GPIO_NUM_35};
// SD (SPI)
const gpio_num_t PIN_SD_SCK{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_8 : GPIO_NUM_19};
const gpio_num_t PIN_SD_MOSI{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_33
                                                    : GPIO_NUM_21};
const gpio_num_t PIN_SD_MISO{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_32
                                                    : GPIO_NUM_22};
const gpio_num_t PIN_SD_CS{GPIO_NUM_14};
// GPS
const int I2C_ADDR_GPS{0x10};
const gpio_num_t PIN_GPS_WAKE{GPIO_NUM_32};

// NeoPixel LED
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

// WiFi Configuration
const int WIFI_RECONNECT_BACKOFF_MS{2000};
const int WIFI_MAX_BACKOFF_MS{30000};
static volatile bool wifiConnecting = false;
static uint32_t wifiReconnectBackoff = WIFI_RECONNECT_BACKOFF_MS;

// Security and Provisioning
String deviceSecret;  // Populated from NVS at boot

// Backend endpoints
const char* UPLOAD_ENDPOINT{"https://oas-data-logger.vercel.app/api/upload/%s"};
const char* OTA_MANIFEST_ENDPOINT{
    "https://oas-data-logger.vercel.app/api/ota/manifest/%s/%s"};
const char* OTA_FIRMWARE_ENDPOINT{
    "https://oas-data-logger.vercel.app/api/ota/firmware/%s/%s/%d"};

// State Machine States
enum class SystemState {
  INIT,
  WAIT_SD,
  WAIT_WIFI,
  OTA_UPDATE,
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

CRGB leds[NUM_LEDS];
TinyGPSPlus gps;
ESP32Time rtc;
WiFiManager wifiManager;
dlf::DLFLogger logger{SD};
// Runtime state
TaskHandle_t gpsTaskHandle{NULL};
dlf::run_handle_t runHandle{0};
bool offloadMode{false};
bool gpsEnabled{false};
unsigned long lastWifiReconnectAttemptMillis{0};
unsigned long lastLoggerStartRunMillis{0};
unsigned long lastLedToggleMillis{0};
unsigned long lastGpsPrintMillis{0};
bool ledToggleState{false};
// State machine
SystemState currentState{SystemState::INIT};
ErrorType currentError{ErrorType::NONE};

// GPS Data Structure with Mutex Protection
struct GpsData {
  double lat;
  double lng;
  double alt;
  uint32_t satellites;
};
GpsData gpsData{0.0, 0.0, 0.0, 0};
SemaphoreHandle_t gpsDataMutex;

// Function forward declarations
void initializeLed();
void updateLedPattern();
void provisionDevice();
void transitionToState(SystemState newState);
void handleInitState();
void handleWaitSdState();
void handleWaitWifiState();
void handleOtaUpdate();
void handleWaitGpsState();
void handleWaitTimeState();
void handleRunningState();
void handleOffloadState();
void handleErrorState();
void handleSleepState();
bool hasUsbPower();
void enableGps();
void disableGps();
String getDeviceUid();
void initializeDLFLogger();
void startLoggerRun();
void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
void gpsTask(void* args);
void sleepMonitorTask(void* args);
void sleepCleanup();
void restart();

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  // Initialize LED first for status indication
  initializeLed();

  // Delay here to give dev some time to connect to Serial Monitor
  vTaskDelay(pdMS_TO_TICKS(3000));

  // Initialize AdvancedLogger
  if (!LittleFS.begin(true)) {
    Serial.println(
        "LittleFS mount failed! AdvancedLogger will not log to LittleFS.");
  }
  AdvancedLogger::begin();
  AdvancedLogger::setPrintLevel(LogLevel::INFO);
  AdvancedLogger::setSaveLevel(LogLevel::INFO);

  LOG_INFO("****System Boot****");
  LOG_INFO("Firmware: version=%s build=%d device=%s channel=%s", FW_VERSION,
           FW_BUILD_NUMBER, DEVICE_TYPE, OTA_CHANNEL);

  provisionDevice();

  // Create mutex for GPS data protection
  gpsDataMutex = xSemaphoreCreateMutex();
  if (gpsDataMutex == NULL) {
    currentError = ErrorType::LOGGER_INIT_FAILED;
    transitionToState(SystemState::ERROR);
    return;
  }

  // Configure pins
  // Read to indicate whether USB power is present
  pinMode(PIN_USB_POWER, INPUT_PULLDOWN);
  // Read to indicate whether sleep button is pressed
  pinMode(PIN_SLEEP_BUTTON, INPUT_PULLUP);
  // Write to wake GPS from standby mode
  pinMode(PIN_GPS_WAKE, OUTPUT);

  // Start sleep monitor task to trigger sleep mode when USB power is
  // disconnected, or sleep button is pressed
  xTaskCreate(sleepMonitorTask, "sleep_monitor", 4096, NULL, 5, NULL);

  // If the device was turned on with USB power, enter standard mode.
  // Otherwise, enter offload mode.
  offloadMode = !hasUsbPower();

  // Start state machine
  transitionToState(SystemState::INIT);
}

void loop() {
  // Print heap usage if needed
  if (PRINT_HEAP_USAGE_INTERVAL_SECS > 0) {
    static unsigned long lastHeapLoggedMillis{0};
    const unsigned long now{millis()};
    if (now - lastHeapLoggedMillis >= PRINT_HEAP_USAGE_INTERVAL_SECS * 1000) {
      lastHeapLoggedMillis = now;
      memory_monitor::logHeap("mem");
    }
  }

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
    case SystemState::OTA_UPDATE:
      handleOtaUpdate();
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

void initializeLed() {
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

    case SystemState::OTA_UPDATE:
      FastLED.showColor(CRGB::Orange);
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

void provisionDevice() {
  device_auth::DeviceAuth auth(getDeviceUid());
  if (!auth.loadSecret(deviceSecret)) {
    LOG_INFO("Device unprovisioned. Waiting for script...");

    deviceSecret = auth.awaitProvisioning();

    LOG_INFO("Provisioning successful. Rebooting in 3s...");
    delay(3000);
    restart();
  } else {
    LOG_INFO("Device already provisioned");
  }
}

void transitionToState(SystemState newState) {
  LOG_DEBUG("State transition: %d -> %d", (int)currentState, (int)newState);
  currentState = newState;

  // Reset LED toggle state on transition
  ledToggleState = false;
  lastLedToggleMillis = millis();
}

void handleInitState() { transitionToState(SystemState::WAIT_SD); }

void handleWaitSdState() {
  LOG_INFO("Initializing SD...");
  SPI.setFrequency(1000000);
  SPI.setDataMode(SPI_MODE0);
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);

  if (SD.begin(PIN_SD_CS)) {
    LOG_INFO("SD card connected");
    transitionToState(SystemState::WAIT_WIFI);
    return;
  }

  // SD card not yet connected. Try again after some delay
  vTaskDelay(pdMS_TO_TICKS(100));
}

bool getSavedSSID(char* out, size_t len) {
  wifi_config_t conf;
  if (esp_wifi_get_config(WIFI_IF_STA, &conf) != ESP_OK) {
    return false;
  }

  strncpy(out, (const char*)conf.sta.ssid, len);
  out[len - 1] = '\0';
  return strlen(out) > 0;
}

void handleWaitWifiState() {
  LOG_INFO("Initializing WiFi...");

  // Set WiFi mode and register event handler
  WiFi.mode(WIFI_STA);
  WiFi.onEvent(onWiFiEvent);
  WiFi.setAutoReconnect(false);  // we'll handle reconnection ourselves

  // Check if we have saved credentials
  char ssid[33];
  if (getSavedSSID(ssid, sizeof(ssid))) {
    // If we have saved credentials, attempt to connect to it
    LOG_INFO("Connecting to saved WiFi: %s", ssid);
    WiFi.begin();
    wifiConnecting = true;
  } else {
    // If we don't have saved credentials, start Config Portal
    LOG_INFO("No saved WiFi credentials found. Starting WiFi Manager...");
    wifiManager.autoConnect();
  }

  // Wait up to 15 seconds for connection
  unsigned long startTime = millis();
  while (wifiConnecting && (millis() - startTime < 15000)) {
    vTaskDelay(pdMS_TO_TICKS(100));
  }

  bool wifiConnected = (WiFi.status() == WL_CONNECTED);
  if (WiFi.status() == WL_CONNECTED) {
    LOG_INFO("WiFi connected successfully");
  } else {
    LOG_INFO("WiFi not connected; continuing without network.");
  }

  if (offloadMode) {
    transitionToState(SystemState::OFFLOAD);
  } else {
    transitionToState(SystemState::OTA_UPDATE);
  }
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      LOG_INFO("[WiFi] STA started");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      // Note: only consider connection as successful when we got the IP, not on
      // ARDUINO_EVENT_WIFI_STA_CONNECTED
      LOG_INFO("[WiFi] Got IP");
      wifiConnecting = false;
      wifiReconnectBackoff = WIFI_RECONNECT_BACKOFF_MS;  // Reset backoff
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      LOG_INFO("[WiFi] Disconnected, reason: %d",
               info.wifi_sta_disconnected.reason);

      if (info.wifi_sta_disconnected.reason == WIFI_REASON_AUTH_FAIL) {
        // Annoyingly, sometimes a disconnect with AUTH_FAIL will fire on the
        // first connection attempt even though credentials are valid. Just
        // ignore this event for now. If invalid credentials are indeed stored
        // on the device, then we'll eventually continue.
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

void handleOtaUpdate() {
  if (ENABLE_OTA_UPDATE && WiFi.status() == WL_CONNECTED) {
    ota::OtaUpdater::Config otaConfig;
    otaConfig.manifestEndpoint = OTA_MANIFEST_ENDPOINT;
    otaConfig.firmwareEndpoint = OTA_FIRMWARE_ENDPOINT;
    otaConfig.deviceType = DEVICE_TYPE;
    otaConfig.channel = OTA_CHANNEL;
    otaConfig.currentBuildNumber = FW_BUILD_NUMBER;
    ota::OtaUpdater otaUpdater(otaConfig);
    auto res{otaUpdater.updateIfAvailable(true)};
    if (!res.ok) {
      LOG_ERROR("[OTA] Error when updating firmware: %s", res.message.c_str());
    }
  }

  transitionToState(SystemState::WAIT_GPS);
}

void handleWaitGpsState() {
  enableGps();

  if (gpsEnabled) {
    transitionToState(SystemState::WAIT_TIME);
    return;
  }
}

void handleWaitTimeState() {
  if (WAIT_FOR_VALID_TIME) {
    // GPS module is the source of epoch time. Ensure that the received time is
    // valid. The PA1010D returns a default/bogus time when there is no valid
    // fix.

    // Request up to 32 bytes of data (enough for a NMEA sentence) from GPS and
    // feed into TinyGPS++
    Wire.requestFrom(I2C_ADDR_GPS, 32);
    while (Wire.available()) {
      char c = Wire.read();
      gps.encode(c);
    }

    // When we receive a time update, only trust it if we also have a location
    // fix and an additional sanity check on the year
    if (gps.date.isUpdated() && gps.date.isValid() && gps.time.isUpdated() &&
        gps.time.isValid() && gps.location.age() < 2000 &&
        gps.date.year() >= 2025) {
      rtc.setTime(gps.time.second(), gps.time.minute(), gps.time.hour(),
                  gps.date.day(), gps.date.month(), gps.date.year());
      LOG_INFO("Valid GPS time received");
    } else {
      // If we still don't have a valid GPS time, print waiting status and try
      // again after a delay
      static unsigned long lastPrintTime = 0;
      if (millis() - lastPrintTime > 5000) {
        lastPrintTime = millis();
        LOG_INFO("Waiting for valid GPS time...");
      }

      vTaskDelay(pdMS_TO_TICKS(1000));
      return;
    }
  }

  xTaskCreate(gpsTask, "gps", 4096, NULL, 5, &gpsTaskHandle);
  // Initialize logger and start run
  initializeDLFLogger();
  startLoggerRun();
  transitionToState(SystemState::RUNNING);
  return;
}

void handleRunningState() {
  // GPS printing logic with enhanced diagnostics
  // Only print if GPS is still enabled (prevents printing during shutdown)
  const unsigned long now{millis()};
  if (gpsEnabled && GPS_PRINT_INTERVAL_SECS > 0 &&
      now - lastGpsPrintMillis > GPS_PRINT_INTERVAL_SECS * 1000) {
    lastGpsPrintMillis = now;

    // Try to get GPS data with mutex protection
    if (xSemaphoreTake(gpsDataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      LOG_DEBUG("[GPS] Lat: %.6f, Lng: %.6f, Alt: %.1fm, Sats: %d", gpsData.lat,
                gpsData.lng, gpsData.alt, gpsData.satellites);
      LOG_DEBUG("[DIAG] RunHandle: %d, Uptime: %lu ms", runHandle, now);
      xSemaphoreGive(gpsDataMutex);
    }
  }

  // Run interval logic - only if LOGGER_RUN_INTERVAL_S > 0
  if (runHandle && LOGGER_RUN_INTERVAL_S > 0 &&
      now - lastLoggerStartRunMillis > LOGGER_RUN_INTERVAL_S * 1000) {
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
  static bool wasInError = false;
  static unsigned long errorStartMillis = 0;

  if (!wasInError) {
    // Just entered the ERROR state. This block should only be run once when we
    // first enter this state
    LOG_ERROR("System in ERROR state. Error type: %d", (int)currentError);
    errorStartMillis = millis();
    wasInError = true;
  }

  // Restart after 10 seconds
  if (millis() - errorStartMillis > 10000) {
    restart();
  }
}

void handleSleepState() {
  LOG_INFO("Entering deep sleep...");

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

  AdvancedLogger::end();

  // Enter deep sleep
  esp_deep_sleep_start();
}

String getDeviceUid() {
  uint64_t raw = ESP.getEfuseMac();
  char id[13];
  sprintf(id, "%012llX", raw);
  return id;
}

void initializeDLFLogger() {
  LOG_INFO("Initializing DLF logger...");

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
  logger.syncTo(UPLOAD_ENDPOINT, getDeviceUid(), deviceSecret, options).begin();

  LOG_INFO("DLF logger initialized");
}

void startLoggerRun() {
  // Stop existing run (if any) and start a new run
  if (runHandle) {
    logger.stopRun(runHandle);
  }
  double m = 0;
  runHandle = logger.startRun(Encodable(m, "double"));
  lastLoggerStartRunMillis = millis();
}

void enableGps() {
  if (gpsEnabled) {
    return;
  }

  LOG_INFO("Initializing GPS...");

  // Initialize I2C
  Wire.begin();

  // Activate wake pin to get the GPS module back to full power mode
  digitalWrite(PIN_GPS_WAKE, HIGH);

  // Wait until GPS starts sending NMEA data
  bool gpsResponding{false};
  while (!gpsResponding) {
    Wire.requestFrom(I2C_ADDR_GPS, 32);
    while (Wire.available()) {
      char c = Wire.read();
      gps.encode(c);
      gpsResponding = true;
    }

    if (gpsResponding) {
      break;
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
  }

  digitalWrite(PIN_GPS_WAKE, LOW);
  gpsEnabled = true;
  LOG_INFO("GPS enabled");
}

void disableGps() {
  if (!gpsEnabled) {
    return;
  }

  // Put GPS in Backup Mode
  if (!USE_LEGACY_GPIO_CONFIG) {
    Wire.beginTransmission(I2C_ADDR_GPS);
    Wire.write("$PMTK225,4*2F\r\n");
    Wire.endTransmission();
  }

  // Close I2C
  Wire.end();

  gpsEnabled = false;
  LOG_INFO("GPS disabled");
}

bool hasUsbPower() {
  if (USB_POWER_OVERRIDE) {
    return USB_POWER_OVERRIDE_VALUE;
  }

  return digitalRead(PIN_USB_POWER);
}

/**
 * Polls GPS data from I2C.
 */
void gpsTask(void* args) {
  while (true) {
    // Request up to 32 bytes of data (enough for a NMEA sentence) from GPS and
    // feed into TinyGPS++
    Wire.requestFrom(I2C_ADDR_GPS, 32);
    while (Wire.available()) {
      char c = Wire.read();
      gps.encode(c);
    }

    if (xSemaphoreTake(gpsDataMutex, portMAX_DELAY) == pdTRUE) {
      if (gps.satellites.isUpdated() && gps.satellites.isValid()) {
        gpsData.satellites = gps.satellites.value();
      }

      if (gps.location.isUpdated() && gps.location.isValid()) {
        gpsData.lat = gps.location.lat();
        gpsData.lng = gps.location.lng();
        gpsData.alt = gps.altitude.meters();
      }

      xSemaphoreGive(gpsDataMutex);
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

/**
 * Monitors for deep sleep conditions. When conditions are met, puts ESP32 into
 * deep sleep. The device will be woken up when USB power is available again.
 */
void sleepMonitorTask(void* args) {
  vTaskDelay(pdMS_TO_TICKS(5000));

  bool usbSleepTriggered{false};
  while (true) {
    // Only check sleep conditions if we're in RUNNING state
    if (currentState == SystemState::RUNNING) {
      // Check sleep button
      bool sleepButtonPressed = !digitalRead(PIN_SLEEP_BUTTON);
      if (sleepButtonPressed) {
        unsigned long pressStart{millis()};
        while (!digitalRead(PIN_SLEEP_BUTTON)) {
          if (millis() - pressStart >= WIFI_RECONFIG_BUTTON_HOLD_TIME_MS) {
            // Sleep button has been long pressed
            LOG_INFO(
                "[WiFi Reconfiguration] WiFi reconfiguration mode entered...");

            sleepCleanup();
            vTaskDelay(pdMS_TO_TICKS(100));
            logger.waitForSyncCompletion();
            LOG_INFO("[WiFi Reconfiguration] Resetting WiFiManager...");
            wifiManager.resetSettings();  // uses vTaskDelay internally
            LOG_INFO("[WiFi Reconfiguration] Rebooting device into AP mode...");
            restart();
            break;
          }
          yield();
        }

        if (millis() - pressStart < WIFI_RECONFIG_BUTTON_HOLD_TIME_MS) {
          // Sleep button has been short pressed
          sleepCleanup();
          transitionToState(SystemState::OFFLOAD);
          break;
        }
      }
    }

    // Make sure USB power is gone for 2 cycles before triggering sleep.
    bool usbSleep{!offloadMode && !hasUsbPower()};
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

void sleepCleanup() {
  disableGps();
  vTaskDelay(pdMS_TO_TICKS(100));
  if (runHandle) {
    logger.stopRun(runHandle);
    runHandle = 0;
  }
}

void restart() {
  AdvancedLogger::end();
  ESP.restart();
}