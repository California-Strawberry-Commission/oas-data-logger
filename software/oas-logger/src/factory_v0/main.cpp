#include <Arduino.h>
#include <FastLED.h>
#include <WiFiManager.h>

// Serial
const unsigned long SERIAL_BAUD_RATE{115200};

// Input pins
const gpio_num_t PIN_USER_BUTTON{GPIO_NUM_35};

// NeoPixel LED
#define LED_PIN PIN_NEOPIXEL
#define LED_TYPE WS2812
#define LED_COLOR_ORDER GRB
const int NUM_LEDS{1};
const uint8_t LED_BRIGHTNESS{10};

CRGB leds[NUM_LEDS];
WiFiManager wifiManager;

static bool shouldResetWifi() {
  bool userButtonPressed{!digitalRead(PIN_USER_BUTTON)};
  return userButtonPressed;
}

static void connectWifiWithPortal() {
  wifiManager.setConnectTimeout(
      20);  // seconds. Avoid long stalls on bad credentials
  wifiManager.setCaptivePortalEnable(true);

  if (shouldResetWifi()) {
    Serial.println("Resetting WiFi settings");
    wifiManager.resetSettings();
  }

  // Automatically connect using saved credentials. If there are no existing
  // credentials or connection fails, start an access point. If configuration
  // fails for whatever reason, then restart the device. Note that this blocks
  // until configuration is complete.
  if (!wifiManager.autoConnect()) {
    Serial.println("WiFi failed to connect. Restarting device...");
    ESP.restart();
  } else {
    Serial.println("WiFi connected");
    FastLED.showColor(CRGB::Green);
  }
}

void setup() {
  FastLED.addLeds<LED_TYPE, LED_PIN, LED_COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(LED_BRIGHTNESS);
  FastLED.showColor(CRGB::White);

  Serial.begin(SERIAL_BAUD_RATE);

  // Read to indicate whether the user button is pressed
  pinMode(PIN_USER_BUTTON, INPUT_PULLUP);

  // Add delay to give time for serial to initialize
  vTaskDelay(pdMS_TO_TICKS(1000));

  connectWifiWithPortal();
}

void loop() { delay(10); }