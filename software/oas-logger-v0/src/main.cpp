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

// Various flags for testing purposes
const bool USB_POWER_OVERRIDE{false};
const bool USB_POWER_OVERRIDE_VALUE{false};
const bool WAIT_FOR_VALID_TIME{true};
const bool USE_LEGACY_GPIO_CONFIG{false};
// Every X seconds, start a new run. Negative or zero means do not cut a run
// (except when going to sleep).
const int LOGGER_RUN_INTERVAL_S{0};
const bool LOGGER_MARK_AFTER_UPLOAD{true};
const bool LOGGER_DELETE_AFTER_UPLOAD{false};

// Serial
const unsigned long SERIAL_BAUD_RATE{115200};

// Input pins
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

// NeoPixel LED
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

// GPS
const int I2C_ADDR_GPS{0x10};
const gpio_num_t PIN_GPS_WAKE{GPIO_NUM_32};

// WIFI
const unsigned long WIFI_CONFIG_AP_TIMEOUT_S{120};
const char* WIFI_CONFIG_AP_NAME{"OASDataLogger"};
const int WIFI_RECONNECT_ATTEMPT_INTERVAL_MS{5000};

// TODO: Configure upload endpoint in Access Point mode
const char* UPLOAD_ENDPOINT{"https://oas-data-logger.vercel.app/api/upload/%s"};

void waitForValidTime();
void waitForSd();
void initializeWifi();
bool wifiCredentialsExist();
String getDeviceUid();
void initializeLogger();
void startLoggerRun();
void enableGps();
void disableGps();
bool hasUsbPower();
void gpsTask(void* args);
void sleepMonitorTask(void* args);

CRGB leds[NUM_LEDS];
TinyGPSPlus gps;
ESP32Time rtc;
WiFiManager wifiManager;
unsigned long lastWifiReconnectAttemptMillis{0};
CSCLogger logger{SD};
unsigned long lastLoggerStartRunMillis{0};
run_handle_t runHandle{0};
bool offloadMode{false};
bool gpsEnabled{false};

// Logger data
struct {
  double lat;
  double lng;
  double alt;
  uint32_t satellites;
} pos{0.0, 0.0, 0.0, 0};

void setup() {
  FastLED.addLeds<LED_TYPE, LED_PIN, LED_COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(LED_BRIGHTNESS);
  FastLED.showColor(CRGB::White);

  Serial.begin(SERIAL_BAUD_RATE);

  // Configure pins
  // Read to indicate whether USB power is present
  pinMode(PIN_USB_POWER, INPUT_PULLDOWN);
  // Read to indicate whether sleep button is pressed
  pinMode(PIN_SLEEP_BUTTON, INPUT_PULLUP);
  // Write to wake GPS from standby mode
  pinMode(PIN_GPS_WAKE, OUTPUT);

  // Add delay to give time for serial to initialize
  vTaskDelay(pdMS_TO_TICKS(1000));

  // Start sleep monitor task to trigger sleep mode when USB power is
  // disconnected, or sleep button is pressed
  xTaskCreate(sleepMonitorTask, "sleep_monitor", 4096, NULL, 5, NULL);

  // If the device was turned on with USB power, enter standard mode.
  // Otherwise, enter offload mode.
  if (hasUsbPower()) {
    // Standard mode (create a new run on the logger and poll messages from GPS)
    offloadMode = false;

    // We initialize as much as possible before enabling the GPS and waiting for
    // valid time, as it can take a while to acquire a fix. The logger can be
    // initialized here (which starts the upload task), but only start the run
    // as the very last step.
    waitForSd();
    initializeWifi();
    initializeLogger();

    // Enable GPS, wait for valid time, and start GPS update task in that order.
    // Note that we need to enable GPS first as the time comes from the GPS
    // module.
    enableGps();
    waitForValidTime();
    xTaskCreate(gpsTask, "gps", 4096, NULL, 5, NULL);

    startLoggerRun();

    FastLED.showColor(CRGB::Green);
  } else {
    // Offload mode (upload any available run data)
    offloadMode = true;

    waitForSd();
    initializeWifi();
    initializeLogger();

    FastLED.showColor(CRGB::Yellow);

    // Just in case for logger sync/upload to start
    vTaskDelay(pdMS_TO_TICKS(100));

    logger.waitForSyncCompletion();
    FastLED.showColor(CRGB::Blue);
    // TODO: Maybe go back to sleep after sync complete
  }
}

void loop() {
  // Required when using WiFiManager in non-blocking mode
  wifiManager.process();

  // If disconnected, try reconnecting periodically
  // TODO: Add a way to enter Access Point mode on demand
  if (WiFi.status() != WL_CONNECTED && !wifiManager.getConfigPortalActive() &&
      millis() - lastWifiReconnectAttemptMillis >
          WIFI_RECONNECT_ATTEMPT_INTERVAL_MS) {
    Serial.println("WiFi not connected, retrying...");
    WiFi.begin();  // reattempt connection with stored credentials (if any)
    lastWifiReconnectAttemptMillis = millis();
  }

  if (runHandle && LOGGER_RUN_INTERVAL_S > 0 &&
      millis() - lastLoggerStartRunMillis > LOGGER_RUN_INTERVAL_S * 1000) {
    startLoggerRun();
  }
}

void waitForValidTime() {
  // GPS module is the source of epoch time. Ensure that the received time is
  // valid. The PA1010D returns a default/bogus time when there is no valid fix.
  while (WAIT_FOR_VALID_TIME) {
    FastLED.showColor(CRGB::Yellow);

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
      Serial.println("Valid time received");
      break;
    }

    vTaskDelay(pdMS_TO_TICKS(250));
    FastLED.showColor(CRGB::Black);
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

void waitForSd() {
  SPI.setFrequency(1000000);
  SPI.setDataMode(SPI_MODE0);
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  while (!SD.begin(PIN_SD_CS)) {
    FastLED.showColor(CRGB::Red);
    vTaskDelay(pdMS_TO_TICKS(500));
    FastLED.showColor(CRGB::Black);
    vTaskDelay(pdMS_TO_TICKS(500));
  }
  Serial.println("SD card connected");
}

void initializeWifi() {
  WiFi.mode(WIFI_STA);
  wifiManager.setConfigPortalBlocking(false);
  wifiManager.setConfigPortalTimeout(WIFI_CONFIG_AP_TIMEOUT_S);
  if (!wifiManager.autoConnect(WIFI_CONFIG_AP_NAME)) {
    Serial.println(
        "Wi-Fi credentials missing or failed to connect. Starting "
        "ConfigPortal");
  }
}

bool wifiCredentialsExist() {
  wifi_config_t conf;
  esp_err_t result = esp_wifi_get_config(WIFI_IF_STA, &conf);

  if (result != ESP_OK) {
    Serial.printf("esp_wifi_get_config failed: %d\n", result);
    return false;
  }

  // Check if SSID is non-empty
  return strlen((const char*)conf.sta.ssid) > 0;
}

String getDeviceUid() {
  uint64_t raw = ESP.getEfuseMac();
  char id[13];
  sprintf(id, "%012llX", raw);
  return id;
}

void initializeLogger() {
  auto satellitesLogInterval{std::chrono::seconds(5)};
  POLL(logger, pos.satellites, satellitesLogInterval);

  auto gpsDataLogInterval{std::chrono::seconds(1)};
  POLL(logger, pos.lat, gpsDataLogInterval);
  POLL(logger, pos.lng, gpsDataLogInterval);
  POLL(logger, pos.alt, gpsDataLogInterval);

  uint64_t raw = ESP.getEfuseMac();
  char id[13];
  sprintf(id, "%012llX", raw);
  String deviceUid = id;

  dlf::components::UploaderComponent::Options options;
  options.markAfterUpload = LOGGER_MARK_AFTER_UPLOAD;
  options.deleteAfterUpload = LOGGER_DELETE_AFTER_UPLOAD;
  logger.syncTo(UPLOAD_ENDPOINT, getDeviceUid(), options).begin();
}

void startLoggerRun() {
  // Stop existing run (if any) and start a new run
  if (runHandle) {
    logger.stop_run(runHandle);
  }
  double m = 0;
  runHandle = logger.start_run(Encodable(m, "double"));
  lastLoggerStartRunMillis = millis();
}

void enableGps() {
  if (gpsEnabled) {
    return;
  }

  // Initialize I2C
  Wire.begin();

  // Activate wake pin to get the GPS module back to full power mode
  digitalWrite(PIN_GPS_WAKE, HIGH);

  // Wait until GPS starts sending NMEA data
  bool gpsResponding{false};
  while (!gpsResponding) {
    FastLED.showColor(CRGB::Yellow);
    Wire.requestFrom(I2C_ADDR_GPS, 32);
    while (Wire.available()) {
      char c = Wire.read();
      gps.encode(c);
      gpsResponding = true;
    }

    if (gpsResponding) {
      break;
    }

    vTaskDelay(pdMS_TO_TICKS(500));
    FastLED.showColor(CRGB::Black);
    vTaskDelay(pdMS_TO_TICKS(500));
  }

  digitalWrite(PIN_GPS_WAKE, LOW);
  gpsEnabled = true;
  Serial.println("GPS enabled");
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
  Serial.println("GPS disabled");
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

    if (gps.satellites.isUpdated() && gps.satellites.isValid()) {
      pos.satellites = gps.satellites.value();
    }

    if (gps.location.isUpdated() && gps.location.isValid()) {
      pos.lat = gps.location.lat();
      pos.lng = gps.location.lng();
      pos.alt = gps.altitude.meters();
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
    bool sleepButtonPressed{!digitalRead(PIN_SLEEP_BUTTON)};
    if (sleepButtonPressed) {
      Serial.println("[Sleep Monitor] Sleep button pressed. Going to sleep");
      break;
    }

    // Make sure USB power is gone for 2 cycles before triggering sleep.
    bool usbSleep{!offloadMode && !hasUsbPower()};
    if (usbSleep && usbSleepTriggered) {
      Serial.println(
          "[Sleep Monitor] USB power still disconnected. Going to sleep");
      break;
    }
    usbSleepTriggered = usbSleep;
    if (usbSleep) {
      Serial.println("[Sleep Monitor] USB power disconnected");
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
  }

  FastLED.showColor(CRGB::Orange);

  // If there is an active run, stop it and attempt to upload its data
  if (runHandle) {
    logger.stop_run(runHandle);
    runHandle = 0;
    Serial.println("[Sleep Monitor] Stopped active run");
    // Just in case for logger sync/upload to start
    vTaskDelay(pdMS_TO_TICKS(100));
    logger.waitForSyncCompletion();
  }

  // Turn off peripherals
  SD.end();
  Serial.println("[Sleep Monitor] Stopped SD");
  if (gpsEnabled) {
    disableGps();
    Serial.println("[Sleep Monitor] Stopped GPS");
  }

  // Turn off LED
  FastLED.showColor(CRGB::Black);

  if (!hasUsbPower()) {
    // Plugging in USB power will wake
    esp_sleep_enable_ext1_wakeup((1ULL << PIN_USB_POWER),
                                 ESP_EXT1_WAKEUP_ANY_HIGH);
  }

  Serial.println("[Sleep Monitor] Goodnight");
  Serial.flush();
  Serial.end();
  esp_deep_sleep_start();
}