#include <Arduino.h>
#include <ESP32Time.h>
#include <FastLED.h>
#include <SD.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Wire.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <dlf_logger.h>

// Configuration
const int SERIAL_BAUD_RATE{115200};
const uint32_t LOGGER_MARK_AFTER_UPLOAD{100 * 1024};
const bool LOGGER_DELETE_AFTER_UPLOAD{true};
const bool WAIT_FOR_VALID_TIME{true};
const bool USE_LEGACY_GPIO_CONFIG{true};
const bool USB_POWER_OVERRIDE{false};
const bool USB_POWER_OVERRIDE_VALUE{true};
const int LOGGER_RUN_INTERVAL_S{0};
const int GPS_PRINT_INTERVAL_MS{1000};  

// Pin Definitions
const gpio_num_t PIN_USB_POWER{GPIO_NUM_13};
const gpio_num_t PIN_SLEEP_BUTTON{GPIO_NUM_35};
const gpio_num_t PIN_SD_SCK{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_8 : GPIO_NUM_19};
const gpio_num_t PIN_SD_MOSI{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_33 : GPIO_NUM_21};
const gpio_num_t PIN_SD_MISO{USE_LEGACY_GPIO_CONFIG ? GPIO_NUM_32 : GPIO_NUM_22};
const gpio_num_t PIN_SD_CS{GPIO_NUM_14};
const gpio_num_t PIN_GPS_WAKE{GPIO_NUM_5}; // CURRENTLY UNCONNECTED ON PROTOTYPE

// LED Configuration
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

// GPS Configuration
const int I2C_ADDR_GPS{0x10};

// WiFi Configuration
const char* WIFI_CONFIG_AP_NAME{"OASDataLogger"};
const int WIFI_RECONNECT_ATTEMPT_INTERVAL_MS{10000};

// Uncomment for online database
//const char* UPLOAD_HOST{"oas-data-logger.vercel.app"};
//const uint16_t UPLOAD_PORT{443};

const char* UPLOAD_HOST{"192.168.1.129"};  // Your computer's local IP
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
TinyGPSPlus gps;
ESP32Time rtc;
WiFiManager wifiManager;
CSCLogger logger{SD};
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
  Serial.println("Initializing WiFi...");
  
  WiFi.mode(WIFI_STA);
  wifiManager.setConfigPortalBlocking(true);
  
  if (wifiCredentialsExist()) {
    Serial.println("WiFi credentials exist, attempting to connect...");
    WiFi.begin();
    transitionToState(offloadMode ? SystemState::OFFLOAD : SystemState::WAIT_GPS);
  } else {
    Serial.println("No WiFi credentials, launching config portal...");
    
    if (!wifiManager.autoConnect(WIFI_CONFIG_AP_NAME)) {
      currentError = ErrorType::WIFI_CONFIG_FAILED;
      transitionToState(SystemState::ERROR);
      return;
    }
    
    transitionToState(offloadMode ? SystemState::OFFLOAD : SystemState::WAIT_GPS);
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
    // Check if we have valid time
    if (gps.date.isUpdated() && gps.date.isValid() && 
        gps.time.isUpdated() && gps.time.isValid() && 
        gps.location.age() < 2000 && gps.date.year() >= 2025) {
      
      rtc.setTime(gps.time.second(), gps.time.minute(), gps.time.hour(),
                  gps.date.day(), gps.date.month(), gps.date.year());
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
  if (WiFi.status() != WL_CONNECTED &&
      millis() - lastWifiReconnectAttemptMillis > WIFI_RECONNECT_ATTEMPT_INTERVAL_MS) {
    Serial.println("WiFi not connected, retrying...");
    WiFi.begin();
    lastWifiReconnectAttemptMillis = millis();
  }
  
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
  initializeLogger();                                   // WHY do we reinit? 
  
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
  
  // Initialize I2C
  if (!Wire.begin()) {
    currentError = ErrorType::I2C_INIT_FAILED;
    transitionToState(SystemState::ERROR);
    return;
  }
  
  // Activate wake pin
  digitalWrite(PIN_GPS_WAKE, HIGH);
  
  // Wait for GPS to respond
  bool gpsResponding = false;
  int attempts = 0;
  const int maxAttempts = 10;
  
  while (!gpsResponding && attempts < maxAttempts) {
    Wire.requestFrom(I2C_ADDR_GPS, 32);
    while (Wire.available()) {
      char c = Wire.read();
      gps.encode(c);
      gpsResponding = true;
    }
    
    if (!gpsResponding) {
      attempts++;
      vTaskDelay(pdMS_TO_TICKS(500));
    }
  }
  
  if (!gpsResponding) {
    currentError = ErrorType::GPS_NOT_RESPONDING;
    transitionToState(SystemState::ERROR);
    return;
  }
  
  digitalWrite(PIN_GPS_WAKE, LOW);
  gpsEnabled = true;
  Serial.println("GPS enabled");
}

void disableGps() {
  if (!gpsEnabled) {
    return;
  }
  
  Serial.println("Disabling GPS...");

  // Check if the task handle is valid
  if (gpsTask != NULL)
  {
      Serial.println("[GPS] Deleting GPS task...");
      // Delete the task
      vTaskDelete(xGPS_Handle);
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
    // Request data from GPS
    Wire.requestFrom(I2C_ADDR_GPS, 32);
    
    // Process received data
    while (Wire.available()) {
      char c = Wire.read();
      gps.encode(c);
    }
    
    // Update GPS data with mutex protection
    if (xSemaphoreTake(gpsDataMutex, portMAX_DELAY) == pdTRUE) {
      // Make sure the data will be valid
      if (gps.satellites.isUpdated() && gps.satellites.isValid() && gps.satellites.value() != 0 ) {
        gpsData.satellites = gps.satellites.value();

        if (gps.location.isUpdated() && gps.location.isValid()) {
          gpsData.lat = gps.location.lat();
          gpsData.lng = gps.location.lng();
          gpsData.alt = gps.altitude.meters();
        }
      }
      xSemaphoreGive(gpsDataMutex);
    }
    
    vTaskDelay(pdMS_TO_TICKS(100));
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