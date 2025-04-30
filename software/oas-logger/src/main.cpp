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
#include <Wire.h>
#include <dlf_logger.h>

// For testing purposes
#define USB_POWER_OVERRIDE false

// Serial
#define SERIAL_BAUD_RATE 115200

// Input pins
// Note: GPIO13 is also shared with the built-in LED (not the NeoPixel LED). The
// built-in LED is used as a USB power indicator.
#define PIN_USB_POWER GPIO_NUM_13
#define PIN_SLEEP_BUTTON GPIO_NUM_35

// SD (SPI)
#define PIN_SD_SCK GPIO_NUM_19
#define PIN_SD_MOSI GPIO_NUM_21
#define PIN_SD_MISO GPIO_NUM_22
#define PIN_SD_CS GPIO_NUM_14

// NeoPixel LED
#define LED_PIN PIN_NEOPIXEL
#define NUM_LEDS 1
#define LED_BRIGHTNESS 10
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB

// GPS
#define I2C_ADDR_GPS 0x10
#define PIN_GPS_WAKE GPIO_NUM_32

void waitForValidTime();
void waitForSd();
void initializeLogger();
void enableGps();
void disableGps();
bool hasUsbPower();
void gpsTask(void* args);
void sleepMonitorTask(void* args);

CRGB leds[NUM_LEDS];
TinyGPSPlus gps;
ESP32Time rtc;
CSCLogger logger{SD};
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
  delay(1000);

  // Start sleep monitor task to trigger sleep mode when USB power is
  // disconnected, or sleep button is pressed
  xTaskCreate(sleepMonitorTask, "sleep_monitor", 4096, NULL, 5, NULL);

  // If the device was turned on with USB power, enter standard mode.
  // Otherwise, enter offload mode.
  if (hasUsbPower()) {
    // Standard mode (create a new run on the logger and poll messages from GPS)
    offloadMode = false;

    // Enable GPS, wait for valid time, and start GPS update task in that order.
    // Note that the order is important as the time comes from the GPS module.
    enableGps();
    waitForValidTime();
    xTaskCreate(gpsTask, "gps", 4096, NULL, 5, NULL);

    waitForSd();
    initializeLogger();

    // Start logger run
    double m = 0;
    runHandle = logger.start_run(Encodable(m, "double"));

    FastLED.showColor(CRGB::Green);
  } else {
    // Offload mode (upload any available run data)
    offloadMode = true;

    waitForSd();
    initializeLogger();

    FastLED.showColor(CRGB::Blue);

    // TODO: add indication when upload is complete (and maybe go back to sleep)
  }
}

void loop() {
  // No-op
  delay(1000);
}

void waitForValidTime() {
  // GPS module is the source of epoch time. Ensure that the received time is
  // valid. The PA1010D returns a default/bogus time when there is no valid fix.
  while (true) {
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

    delay(250);
    FastLED.showColor(CRGB::Black);
    delay(250);
  }
}

void waitForSd() {
  SPI.setFrequency(1000000);
  SPI.setDataMode(SPI_MODE0);
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  while (!SD.begin(PIN_SD_CS)) {
    FastLED.showColor(CRGB::Red);
    delay(500);
    FastLED.showColor(CRGB::Black);
    delay(500);
  }
  Serial.println("SD card connected");
}

void initializeLogger() {
  // logger.wifi("my_ssid", "12345678").syncTo("someurl.com", 3000);

  auto satellitesLogInterval{std::chrono::seconds(5)};
  POLL(logger, pos.satellites, satellitesLogInterval);

  auto gpsDataLogInterval{std::chrono::seconds(1)};
  POLL(logger, pos.lat, gpsDataLogInterval);
  POLL(logger, pos.lng, gpsDataLogInterval);
  POLL(logger, pos.alt, gpsDataLogInterval);

  logger.begin();
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

    delay(500);
    FastLED.showColor(CRGB::Black);
    delay(500);
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
  Wire.beginTransmission(I2C_ADDR_GPS);
  Wire.write("$PMTK225,4*2F\r\n");
  Wire.endTransmission();
  // Close I2C
  Wire.end();
  gpsEnabled = false;
  Serial.println("GPS disabled");
}

bool hasUsbPower() { return USB_POWER_OVERRIDE || digitalRead(PIN_USB_POWER); }

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

    delay(100);
  }
}

/**
 * Monitors for deep sleep conditions. When conditions are met, puts ESP32 into
 * deep sleep. The device will be woken up when USB power is available again.
 */
void sleepMonitorTask(void* args) {
  delay(5000);

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

    delay(1000);
  }

  if (runHandle) {
    logger.stop_run(runHandle);
    Serial.println("[Sleep Monitor] Stopped active run");
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
