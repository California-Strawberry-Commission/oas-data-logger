#include <Arduino.h>
#include <ESP32Time.h>
#include <FastLED.h>
#include <SD.h>
#include <SparkFun_u-blox_GNSS_v3.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Wire.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <dlf_logger.h>

#include "FS.h"
#include "SD_MMC.h"

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
// const gpio_num_t PIN_SD_CLK{GPIO_NUM_7};     // Clock
// const gpio_num_t PIN_SD_CMD{GPIO_NUM_8};     // Command
// const gpio_num_t PIN_SD_D0{GPIO_NUM_9};      // Data 0
// const gpio_num_t PIN_SD_D1{GPIO_NUM_10};     // Data 1 (for 4-bit mode)
// const gpio_num_t PIN_SD_D2{GPIO_NUM_11};     // Data 2 (for 4-bit mode)
// const gpio_num_t PIN_SD_D3{GPIO_NUM_12};     // Data 3 (for 4-bit mode)
const gpio_num_t PIN_SD_SCK{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_8 : GPIO_NUM_26};
const gpio_num_t PIN_SD_MOSI{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_33 : GPIO_NUM_21}; //AKA DI
const gpio_num_t PIN_SD_MISO{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_32 : GPIO_NUM_33}; //AKA DO
const gpio_num_t PIN_SD_CS{GPIO_NUM_14};
const gpio_num_t PIN_GPS_WAKE{GPIO_NUM_5}; // Used for power control on SAM-M10Q
const gpio_num_t PIN_GPS_SDA{GPIO_NUM_40};
const gpio_num_t PIN_GPS_SCL{GPIO_NUM_39};

// LED Configuration
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

// GPS Configuration
// SAM-M10Q default I2C address is 0x42
const int I2C_ADDR_GPS{0x42};
const uint32_t GPS_UPDATE_RATE_MS{100}; // 10Hz update rate

// WiFi Configuration
const char* WIFI_CONFIG_AP_NAME{"OASDataLogger"};
const int WIFI_RECONNECT_ATTEMPT_INTERVAL_MS{10000};

// Uncomment for online database
//const char* UPLOAD_HOST{"oas-data-logger.vercel.app"};
//const uint16_t UPLOAD_PORT{443};

const char* UPLOAD_HOST{"10.185.61.111"};  // Your computer's local IP
const uint16_t UPLOAD_PORT{3000};

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
  I2C_INIT_FAILED,
  WIFI_CONFIG_FAILED,
  LOGGER_INIT_FAILED
};

// Global Objects
CRGB leds[NUM_LEDS];
SFE_UBLOX_GNSS myGNSS;  // u-blox GNSS object
ESP32Time rtc;
WiFiManager wifiManager;
CSCLogger logger{SD};  
// CSCLogger logger{SD_MMC};
TaskHandle_t xGPS_Handle;

// State Machine Variables
SystemState currentState = SystemState::INIT;
ErrorType currentError = ErrorType::NONE;
bool offloadMode = false;
bool gpsEnabled = false;
run_handle_t runHandle{0};

// Timing Variables
unsigned long lastWifiReconnectAttemptMillis{0};
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
void testNetworkConnectivity(void);
void scanI2C(void);

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
  pinMode(PIN_GPS_WAKE, OUTPUT);
  
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
        case ErrorType::I2C_INIT_FAILED:
          blinkInterval = 600; // Slow blink
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

// Uncomment for SDIO
// void handleWaitSdState() {
//   Serial.println("Initializing SDIO for SD card...");

//   // Configure the pins for SDIO
//   if (!SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0, PIN_SD_D1, PIN_SD_D2, PIN_SD_D3)) {
//     Serial.println("Pin configuration failed!");
//     return;
//   }

//   // Initialize SD_MMC
//   // Parameters: mount point, mode1bit, format_if_failed, sd_max_frequency, max_files
//   if (SD_MMC.begin("/sdcard", false)) {  // false = use 4-bit mode
//     Serial.println("SD card connected via SDIO");
//     transitionToState(SystemState::WAIT_WIFI);
//   } else {
//     Serial.println("SD card initialization failed");
//     // Keep trying, no immediate error transition
//   }
// }

// __--''--____--''--____--''--____--''--____--''--____--''--__
// 
// >> Add PULL UP RESISTORS (10k) on ALL SDIO data lines!! <<
// 
// __--''--____--''--____--''--____--''--____--''--____--''--__


void handleWaitSdState() {

  Serial.println("Initializing SPI for SD card...");

  SPI.setFrequency(1000000);
  SPI.setDataMode(SPI_MODE0);

  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS); // No return value to check

  if (SD.begin(PIN_SD_CS)) {
    Serial.println("SD card connected");
    transitionToState(SystemState::WAIT_WIFI);
  }

  // Keep trying, no immediate error transition
}

void handleWaitWifiState() {
  transitionToState(SystemState::WAIT_GPS);  // FORT TESTING GPS ONLY, WO WIFI
  return;

  Serial.println("Initializing WiFi...");
  WiFi.mode(WIFI_STA);
  wifiManager.setConfigPortalBlocking(true);

  bool hasCreds = wifiCredentialsExist();

  if (offloadMode) {
    if (hasCreds) {
      Serial.println("Offload mode with credentials, attempting to connect indefinitely...");
      WiFi.begin();
      while (WiFi.status() != WL_CONNECTED) {
        Serial.println("Waiting for WiFi (offload mode)...");
        delay(1000);
      }
      Serial.println("Connected to WiFi.");
      testNetworkConnectivity();
      transitionToState(SystemState::OFFLOAD);
    } else {
      Serial.println("Offload mode with no credentials, entering AP mode indefinitely...");
      wifiManager.setConfigPortalTimeout(0); // Block until credentials provided
      if (!wifiManager.autoConnect(WIFI_CONFIG_AP_NAME)) {
        currentError = ErrorType::WIFI_CONFIG_FAILED;
        transitionToState(SystemState::ERROR);
        return;
      }
      Serial.println("Credentials acquired in AP mode.");
      transitionToState(SystemState::OFFLOAD);
    }
  } else {
    if (hasCreds) {
      Serial.println("Normal mode with credentials, attempting connection...");
      WiFi.begin();
      unsigned long startAttempt = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
        delay(500);
        Serial.print(".");
      }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nConnected to WiFi.");
      testNetworkConnectivity();
      transitionToState(SystemState::WAIT_GPS);
    } else {
      Serial.println("\nConnection failed, entering AP mode for 3 minutes...");
      wifiManager.setConfigPortalTimeout(180); // 3 minutes
      wifiManager.startConfigPortal(WIFI_CONFIG_AP_NAME);
      Serial.println("Exiting AP mode (timeout or user finished). Continuing program.");
      transitionToState(SystemState::WAIT_GPS); // Proceed regardless of connection
    }
  } else {
    Serial.println("No credentials, waiting in AP mode until provided...");
    wifiManager.setConfigPortalTimeout(0); // No timeout
    if (!wifiManager.autoConnect(WIFI_CONFIG_AP_NAME)) {
      currentError = ErrorType::WIFI_CONFIG_FAILED;
      transitionToState(SystemState::ERROR);
      return;
    }
    Serial.println("Credentials acquired in AP mode.");
    transitionToState(SystemState::WAIT_GPS);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    testNetworkConnectivity();
  }
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
  // Try to get GPS data with mutex protection
  if (xSemaphoreTake(gpsDataMutex, portMAX_DELAY) == pdTRUE) {
    // Check if we have valid time from GPS
    if (myGNSS.getDateValid() && myGNSS.getTimeValid() && 
        myGNSS.getYear() >= 2025) {
      
      rtc.setTime(myGNSS.getSecond(), myGNSS.getMinute(), myGNSS.getHour(),
                  myGNSS.getDay(), myGNSS.getMonth(), myGNSS.getYear());
      Serial.println("Valid time received");
      
      xSemaphoreGive(gpsDataMutex);
      
      // Initialize logger and start run
      initializeLogger();
      startLoggerRun();
      transitionToState(SystemState::RUNNING);
    } else {
      xSemaphoreGive(gpsDataMutex);
    }
  }
}

void handleRunningState() {
  // WiFi reconnection logic
//   if (WiFi.status() != WL_CONNECTED &&
//       millis() - lastWifiReconnectAttemptMillis > WIFI_RECONNECT_ATTEMPT_INTERVAL_MS) {
//     Serial.println("WiFi not connected, retrying...");
//     WiFi.begin();
//     lastWifiReconnectAttemptMillis = millis();
//   }
  
  // GPS printing logic - independent of logger run interval
  if (millis() - lastGpsPrintMillis > GPS_PRINT_INTERVAL_MS) {
    lastGpsPrintMillis = millis();
    
    // Try to get GPS data with mutex protection
    if (xSemaphoreTake(gpsDataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      Serial.printf("[GPS] Lat: %.6f, Lng: %.6f, Alt: %.1fm, Sats: %d\n", 
                    gpsData.lat, gpsData.lng, gpsData.alt, gpsData.satellites);
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
  // Could add recovery logic here if needed
  
  // Log error details
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

  // Turn off GPS                                 -- TODO
  // Tunr off SD card                             -- TODO
  
  // Configure wake on USB power only if unconnected, else wake on reset.
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
  wifi_config_t conf;
  esp_err_t result = esp_wifi_get_config(WIFI_IF_STA, &conf);
  
  if (result != ESP_OK) {
    Serial.printf("esp_wifi_get_config failed: %d\n", result);
    return false;
  }
  
  return strlen((const char*)conf.sta.ssid) > 0;
}

void enableGps() {
  if (gpsEnabled) {
    return;
  }
  
  Serial.println("Enabling GPS...");

  Wire.setPins(PIN_GPS_SDA, PIN_GPS_SCL); // SDA: 40, SCL: 39
  
  // Initialize I2C
  if (!Wire.begin()) {
    void scanI2C();
    currentError = ErrorType::I2C_INIT_FAILED;
    transitionToState(SystemState::ERROR);
    return;
  }

  printf("i2c init was OK.\n");
  
  // Power on GPS module (if wake pin is connected to power control)
  // digitalWrite(PIN_GPS_WAKE, HIGH);
  
  // Small delay to ensure power stability
  vTaskDelay(pdMS_TO_TICKS(100));
  
  // Initialize u-blox GNSS
  if (!myGNSS.begin(Wire, I2C_ADDR_GPS)) {
    currentError = ErrorType::GPS_NOT_RESPONDING;
    transitionToState(SystemState::ERROR);
    return;
  }
  
  // Configure the u-blox module
  myGNSS.setI2COutput(COM_TYPE_UBX); // Set I2C port to output UBX only (no NMEA)
  myGNSS.setNavigationFrequency(10); // Set output to 10Hz
  myGNSS.setAutoPVT(true); // Tell the GPS to send PVT messages automatically
  myGNSS.saveConfiguration(); // Save the current settings to flash and BBR
  
  // Configure power saving mode if needed
  // myGNSS.powerSaveMode(true); // Enable power save mode
  
  gpsEnabled = true;
  Serial.println("GPS enabled");
}

void disableGps() {
  if (!gpsEnabled) {
    return;
  }
  
  Serial.println("Disabling GPS...");

  // Check if the task handle is valid
  if (xGPS_Handle != NULL)
  {
      Serial.println("[GPS] Deleting GPS task...");
      // Delete the task
      vTaskDelete(xGPS_Handle);
      xGPS_Handle = NULL;
  }
  
  // Turn off power to GPS module (if wake pin is connected to power control)
  // digitalWrite(PIN_GPS_WAKE, LOW);
  
  // Close I2C
  Wire.end();
  
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

void gpsTask(void* args) {
  while (true) {
    // Check for new GPS data
    if (myGNSS.getPVT()) {
      // Update GPS data with mutex protection
      if (xSemaphoreTake(gpsDataMutex, portMAX_DELAY) == pdTRUE) {
        // Get satellite count
        gpsData.satellites = myGNSS.getSIV();
        
        // Check if we have a valid fix
        if (myGNSS.getFixType() > 0 && myGNSS.getInvalidLlh() == false) {
          gpsData.lat = myGNSS.getLatitude() / 10000000.0; // Convert from degrees * 10^7
          gpsData.lng = myGNSS.getLongitude() / 10000000.0; // Convert from degrees * 10^7
          gpsData.alt = myGNSS.getAltitude() / 1000.0; // Convert from mm to meters
        }
        
        xSemaphoreGive(gpsDataMutex);
      }
    }
    
    vTaskDelay(pdMS_TO_TICKS(GPS_UPDATE_RATE_MS));
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
  Serial.println("Testing network connectivity...");
  
  WiFiClient client;
  if (client.connect(UPLOAD_HOST, UPLOAD_PORT)) {
    Serial.println("Successfully connected to upload server");
    client.stop();
  } else {
    Serial.println("Failed to connect to upload server");
  }
}

void scanI2C() {
  Serial.println("Scanning I2C bus...");
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      Serial.println(address, HEX);
    }
  }
  Serial.println("I2C scan complete");
}