#include <arduino.h>
#include "SD_MMC.h"
#include "driver/sdmmc_host.h"
#include "esp_log.h"

// Pin Definitions
const gpio_num_t PIN_SD_CLK{GPIO_NUM_45};    // Clock
const gpio_num_t PIN_SD_CMD{GPIO_NUM_40};    // Command
const gpio_num_t PIN_SD_D0{GPIO_NUM_39};     // Data 0
const gpio_num_t PIN_SD_D1{GPIO_NUM_38};     // Data 1 (for 4-bit mode)
const gpio_num_t PIN_SD_D2{GPIO_NUM_41};     // Data 2 (for 4-bit mode)
const gpio_num_t PIN_SD_D3{GPIO_NUM_42};     // Data 3 (for 4-bit mode)

const gpio_num_t PIN_SD_ENABLE{GPIO_NUM_3};  // Power enable for SD card

// Enable debug logging
static const char* TAG = "SD_DEBUG";
bool initAttempted = false;

void setup() {
  // USB CDC initialization - critical for ESP32-S3
  Serial.begin(115200);

  // CRITICAL: Wait for USB CDC to be ready AND for boot to complete
  // ESP32-S3 samples strapping pins during early boot
  unsigned long startTime = millis();
  while (!Serial && (millis() - startTime < 5000)) {
    delay(100);
  }
  delay(500);  // Extra delay for stability

  Serial.println("\n\n=== ESP32-S3 Boot Test ===");
  Serial.println("Boot successful! ESP32 is running.");
  Serial.printf("Millis: %lu\n", millis());
  Serial.flush();

  // Enable verbose logging for SDMMC
  esp_log_level_set("sdmmc_cmd", ESP_LOG_VERBOSE);
  esp_log_level_set("sdmmc_common", ESP_LOG_VERBOSE);
  esp_log_level_set("sdmmc_sd", ESP_LOG_VERBOSE);

  Serial.println("\n=== SD Card Init Test ===\n");
  Serial.flush();

  // CRITICAL FIX: Delay GPIO 3 configuration until AFTER boot completes
  // GPIO 3 is a strapping pin (JTAG signal source)
  // Setting it LOW during boot interferes with boot process
  Serial.println("Step 1: Configuring power pin (GPIO 3 - strapping pin)...");
  Serial.flush();

  pinMode(PIN_SD_ENABLE, OUTPUT);
  digitalWrite(PIN_SD_ENABLE, LOW);
  Serial.println("Power OFF");
  Serial.flush();
  delay(500);

  digitalWrite(PIN_SD_ENABLE, HIGH);
  Serial.println("Power ON");
  Serial.flush();
  delay(1000);  // Give SD card more time to stabilize

  Serial.println("\nStep 2: Configuring SD_MMC pins (1-bit mode)...");
  Serial.flush();

  // Try 1-bit mode first (more reliable)
  if (!SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0)) {
    Serial.println("ERROR: setPins failed!");
    Serial.flush();
    return;
  }
  Serial.println("Pins configured successfully");
  Serial.flush();

  Serial.println("\nStep 3: Attempting SD_MMC.begin() with 1-bit mode...");
  Serial.println("(This is where it might hang...)");
  Serial.flush();
}

void loop() {
  if (!initAttempted) {
    initAttempted = true;
    
    Serial.println("\n>>> Calling SD_MMC.begin()...");
    Serial.flush();
    
    bool success = SD_MMC.begin("/sdcard", true);  // true = 1-bit mode
    
    Serial.println(">>> SD_MMC.begin() returned!");
    
    if (success) {
      Serial.println("\n✓ SUCCESS! SD card initialized");

      // Print card info
      uint64_t cardSize = SD_MMC.cardSize() / (1024 * 1024);
      Serial.printf("SD Card Size: %llu MB\n", cardSize);
      Serial.printf("Card Type: %d\n", SD_MMC.cardType());
    } else {
      Serial.println("\n✗ FAILED to initialize SD card");
      Serial.println("Possible reasons:");
      Serial.println("  - SD card not inserted");
      Serial.println("  - Wrong pin configuration");
      Serial.println("  - Power issue");
      Serial.println("  - Faulty SD card");
      SD_MMC.end();
    }
  }

  // Blink to show we're alive
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > 1000) {
    lastBlink = millis();
    Serial.println("Loop running...");
  }

  delay(1000);
}

/*

// Configuration
const int SERIAL_BAUD_RATE{115200};
const uint32_t LOGGER_MARK_AFTER_UPLOAD{100 * 1024};
const bool LOGGER_DELETE_AFTER_UPLOAD{true};
const bool WAIT_FOR_VALID_TIME{true};
const bool USE_LEGACY_GPIO_CONFIG{false};
const bool USB_POWER_OVERRIDE{true};
const bool USB_POWER_OVERRIDE_VALUE{true};
const int LOGGER_RUN_INTERVAL_S{0};
const int GPS_PRINT_INTERVAL_MS{1000};  

// Pin Definitions
const gpio_num_t PIN_USB_POWER{GPIO_NUM_13};
const gpio_num_t PIN_SLEEP_BUTTON{GPIO_NUM_0};
const gpio_num_t PIN_SD_CLK{GPIO_NUM_40};    // Clock
const gpio_num_t PIN_SD_CMD{GPIO_NUM_45};    // Command
const gpio_num_t PIN_SD_D0{GPIO_NUM_39};     // Data 0
const gpio_num_t PIN_SD_D1{GPIO_NUM_38};     // Data 1 (for 4-bit mode)
const gpio_num_t PIN_SD_D2{GPIO_NUM_41};     // Data 2 (for 4-bit mode)
const gpio_num_t PIN_SD_D3{GPIO_NUM_42};     // Data 3 (for 4-bit mode)

// GPS Power and Control Pins (TESTED AND WORKING)
const gpio_num_t PIN_GPS_ENABLE{GPIO_NUM_3}; // Power enable for GPS module (same as SD card enable)
const gpio;_num_t PIN_GPS_WAKE{GPIO_NUM_5};   // Wake signal for SAM-M10Q (set HIGH)

// GPS UART Pins (TESTED AND WORKING - RX/TX swapped from schematic)
const gpio_num_t PIN_GPS_TX{GPIO_NUM_36};    // ESP TX -> GPS RX (swapped)
const gpio_num_t PIN_GPS_RX{GPIO_NUM_37};    // ESP RX <- GPS TX (swapped)

// LED Configuration
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

// GPS Configuration
const int GPS_BAUD_RATE{38400};  // SAM-M10Q default
const uint32_t GPS_UPDATE_RATE_MS{100}; // 10Hz update rate
#define mySerial Serial1 // GPS Serial port

// WiFi Configuration
const char* WIFI_CONFIG_AP_NAME{"OASDataLogger"};
const int WIFI_RECONNECT_BACKOFF_MS{2000};
const int WIFI_MAX_BACKOFF_MS{30000};
static volatile bool wifiConnecting = false;
static uint32_t wifiReconnectBackoff = WIFI_RECONNECT_BACKOFF_MS;

// For server hosting
const char* UPLOAD_HOST{"oas-data-logger.vercel.app"};
const uint16_t UPLOAD_PORT{443};

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
CSCLogger logger{SD_MMC};
TaskHandle_t xGPS_Handle = NULL;

// State Machine Variables
SystemState currentState = SystemState::INIT;
ErrorType currentError = ErrorType::NONE;
bool offloadMode = false;
bool gpsEnabled = false;
run_handle_t runHandle{0};

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
void initializeLogger();
void startLoggerRun();
void gpsTask(void* args);
void sleepMonitorTask(void* args);
void testNetworkConnectivity();
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
  
  // GPS power pins - start with GPS off
  pinMode(PIN_GPS_ENABLE, OUTPUT);
  pinMode(PIN_GPS_WAKE, OUTPUT);
  digitalWrite(PIN_GPS_ENABLE, LOW);
  digitalWrite(PIN_GPS_WAKE, LOW);
  
  // Add delay to give time for serial to initialize
  vTaskDelay(pdMS_TO_TICKS(1000));
  
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
      wifiReconnectBackoff = WIFI_RECONNECT_BACKOFF_MS; // Reset backoff
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.print("[WiFi] Got IP: ");
      Serial.println(WiFi.localIP());
      wifiConnecting = false;
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.printf("[WiFi] Disconnected, reason: %d\n", info.wifi_sta_disconnected.reason);
      
      // Handle auth failures differently
      if (info.wifi_sta_disconnected.reason == 201) { // AUTH_FAIL
        Serial.println("[WiFi] Authentication failed - check credentials");
        // Don't auto-reconnect on auth failure
        wifiConnecting = false;
      } else {
        // For other disconnection reasons, use backoff and reconnect
        vTaskDelay(pdMS_TO_TICKS(wifiReconnectBackoff));
        wifiReconnectBackoff = min<uint32_t>(wifiReconnectBackoff * 2, WIFI_MAX_BACKOFF_MS);
        
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
          blinkInterval = 200; // Fast blink
          break;
        case ErrorType::GPS_NOT_RESPONDING:
          blinkInterval = 400; // Medium blink
          break;
        case ErrorType::WIFI_CONFIG_FAILED:
          blinkInterval = 800; // Very slow blink
          break;
        default:
          blinkInterval = 1000; // Default slow blink
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
  Serial.printf("State transition: %d -> %d\n", (int)currentState, (int)newState);
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
  if (!SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0, PIN_SD_D1, PIN_SD_D2, PIN_SD_D3)) {
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
    if (SD_MMC.begin("/sdcard", true, false, SDMMC_FREQ_DEFAULT)) {  // false = 4-bit mode
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
  WiFi.setAutoReconnect(false); // We'll handle reconnection ourselves
  
  // Check if we have saved credentials
  if (WiFi.SSID().length() == 0) {
    Serial.println("No WiFi credentials saved. Starting WiFi Manager...");
    wifiManager.autoConnect(WIFI_CONFIG_AP_NAME);
  } else {
    Serial.printf("Connecting to saved WiFi: %s\n", WiFi.SSID().c_str());
    WiFi.begin(); // Use saved credentials
    wifiConnecting = true;
  }
  
  // Wait up to 15 seconds for connection
  unsigned long startTime = millis();
  while (wifiConnecting && (millis() - startTime < 15000)) {
    vTaskDelay(pdMS_TO_TICKS(100));
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected successfully");
    testNetworkConnectivity();
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
  if (gpsTimeValid && gpsEpoch >= 1735689600  ) { //2025-01-01 UTC
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
  // GPS printing logic
  if (millis() - lastGpsPrintMillis > GPS_PRINT_INTERVAL_MS) {
    lastGpsPrintMillis = millis();
    
    // Try to get GPS data with mutex protection
    if (xSemaphoreTake(gpsDataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      Serial.printf("[GPS] Lat: %.6f, Lng: %.6f, Alt: %.1fm, Sats: %d, Fix: %d\n", 
                    gpsData.lat, gpsData.lng, gpsData.alt, gpsData.satellites, gpsFixType);
      xSemaphoreGive(gpsDataMutex);
    }
  }
  
  // Upload current run if WiFi is connected
  static unsigned long lastUploadAttemptMillis = 0;
  const unsigned long UPLOAD_ATTEMPT_INTERVAL_MS = 30000; // Try upload every 30s
  
  if (WiFi.status() == WL_CONNECTED && 
      millis() - lastUploadAttemptMillis > UPLOAD_ATTEMPT_INTERVAL_MS) {
    lastUploadAttemptMillis = millis();
    
    if (runHandle) {
      // Get the current run directory name
      // The run name format appears to be based on when start_run was called
      // We need to access the logger's current run directory
      
      Serial.println("[Running State] Attempting to upload current run while logging...");

      UploaderComponent::Options tempOptions;
      tempOptions.deleteAfterUpload = false;
      tempOptions.markAfterUpload = false;
      
      // Create a temporary uploader instance for the current run
      UploaderComponent tempUploader(SD, "/", UPLOAD_HOST, UPLOAD_PORT, tempOptions);
      
      // The logger stores runs in the root directory with a specific naming convention
      // We need to find the current run directory
      File root = SD.open("/");
      if (root) {
        File runDir;
        String currentRunPath;
        
        // Find the most recent run directory (which should be our current run)
        // Run directories don't have the lockfile when complete, but our current run
        // should still have it
        while (runDir = root.openNextFile()) {
          if (runDir.isDirectory() && runDir.name()[0] != '.' &&
              strcmp(runDir.name(), "System Volume Information") != 0) {
            
            // Check if this directory has a lockfile (indicating active run)
            File lockCheck = SD.open(String("/") + runDir.name() + "/" + LOCKFILE_NAME);
            if (lockCheck) {

              lockCheck.close();
              currentRunPath = String("/") + runDir.name();
              Serial.printf("[Running State] Found active run: %s\n", runDir.name());

              Serial.println("[Running State] Flushing data and finalizing headers for upload...");
              logger.flush(runHandle); 

              // Upload this run
              String uploadPath = String("/api/upload/") + runDir.name();
              bool uploadSuccess = tempUploader.uploadRun(runDir, uploadPath);

              if (uploadSuccess) {
                Serial.println("[Running State] Successfully uploaded current run data");
                // Note: We don't mark or delete the run since it's still active
              } else {
                Serial.println("[Running State] Failed to upload current run data");
              }
              
              break; // We found and processed the current run
            }
          }
        }
        root.close();
      }
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

bool wifiCredentialsExist() {
  return WiFi.SSID().length() > 0;
}

void enableGps() {
  if (gpsEnabled) return;
  Serial.println("Enabling GPS...");

  // Power cycle the GPS module (TESTED AND WORKING)
  digitalWrite(PIN_GPS_ENABLE, LOW);
  digitalWrite(PIN_GPS_WAKE, LOW);
  vTaskDelay(pdMS_TO_TICKS(100));
  digitalWrite(PIN_GPS_WAKE, HIGH);  // Wake signal must be HIGH
  digitalWrite(PIN_GPS_ENABLE, HIGH); // Power enable HIGH
  vTaskDelay(pdMS_TO_TICKS(1000));    // GPS needs time to boot

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
          gpsData.lat = myGNSS.getLatitude() / 10000000.0;  // Convert from degrees * 10^7
          gpsData.lng = myGNSS.getLongitude() / 10000000.0; // Convert from degrees * 10^7
          gpsData.alt = myGNSS.getAltitudeMSL() / 1000.0;   // Convert from mm to meters
        }
        
        xSemaphoreGive(gpsDataMutex);
      }
      
      // Check time validity more strictly (outside mutex protection)
      // Only consider time valid if we have a fix AND valid date/time
      if (gpsFixType >= 2 && 
          myGNSS.getDateValid() && 
          myGNSS.getTimeValid() && 
          myGNSS.getYear() >= 2025 &&
          myGNSS.getMonth() >= 1 && myGNSS.getMonth() <= 12 &&
          myGNSS.getDay() >= 1 && myGNSS.getDay() <= 31) {
        
        struct tm t = {};
        t.tm_year = myGNSS.getYear() - 1900;
        t.tm_mon = myGNSS.getMonth() - 1;
        t.tm_mday = myGNSS.getDay();
        t.tm_hour = myGNSS.getHour();
        t.tm_min = myGNSS.getMinute();
        t.tm_sec = myGNSS.getSecond();
        
        time_t newEpoch = mktime(&t);
        
        // Additional sanity check
        if (newEpoch >= 1735689600) { // 2025-01-01 UTC
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
  
  // Turn off power to GPS module
  digitalWrite(PIN_GPS_ENABLE, LOW);
  digitalWrite(PIN_GPS_WAKE, LOW);
  
  // Close UART
  mySerial.end();
  
  gpsEnabled = false;
  Serial.println("GPS disabled");
}

void initializeLogger() {
  Serial.println("Initializing logger...");
  
  auto satellitesLogInterval{std::chrono::seconds(5)};
  POLL(logger, gpsData.satellites, satellitesLogInterval);
  
  auto gpsDataLogInterval{std::chrono::seconds(1)};
  POLL(logger, gpsData.lat, gpsDataLogInterval);
  POLL(logger, gpsData.lng, gpsDataLogInterval);
  POLL(logger, gpsData.alt, gpsDataLogInterval);
  
  UploaderComponent::Options options;
  options.markAfterUpload = LOGGER_MARK_AFTER_UPLOAD;
  options.deleteAfterUpload = LOGGER_DELETE_AFTER_UPLOAD;
  logger.syncTo(UPLOAD_HOST, UPLOAD_PORT, options).begin();
  
  Serial.println("Logger initialized");
}

void startLoggerRun() {
  if (runHandle) {
    logger.stop_run(runHandle);
  }
  
  double m = 0;
  runHandle = logger.start_run(Encodable(m, "double"));
  lastLoggerStartRunMillis = millis();
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
        Serial.println("[Sleep Monitor] Sleep button pressed. Starting offload before sleep");
        
        // Stop current run before transitioning to offload
        if (runHandle) {
          logger.stop_run(runHandle);
          runHandle = 0;
        }
        
        transitionToState(SystemState::OFFLOAD);
        break;
      }
      
      // Check USB power for sleep trigger
      bool usbSleep = !offloadMode && !hasUsbPower();
      if (usbSleep && usbSleepTriggered) {
        Serial.println("[Sleep Monitor] USB power disconnected. Starting offload before sleep");
        
        // Stop current run before transitioning to offload
        if (runHandle) {
          logger.stop_run(runHandle);
          runHandle = 0;
        }
        
        transitionToState(SystemState::OFFLOAD);
        break;
      } else if (usbSleep) {
        usbSleepTriggered = true;
      } else {
        usbSleepTriggered = false;
      }
    }
    
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
  
  // Task will be deleted when system enters sleep
  vTaskDelete(NULL);
}

void testNetworkConnectivity() {
  Serial.println("Testing HTTPS connectivity...");
  
  WiFiClientSecure client;
  client.setInsecure(); // For debugging - replace with setCACert() for production
  client.setTimeout(12000);
  
  if (!client.connect(UPLOAD_HOST, UPLOAD_PORT)) {
    Serial.println("HTTPS connect failed");
    return;
  }
  
  // Send a simple HTTP request
  client.printf("GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", UPLOAD_HOST);
  
  // Read response
  unsigned long timeout = millis();
  while (client.connected() && (millis() - timeout < 5000)) {
    if (client.available()) {
      String line = client.readStringUntil('\n');
      Serial.printf("HTTPS response: %s\n", line.c_str());
      break;
    }
  }
  
  client.stop();
  Serial.println("HTTPS test complete");
}

*/