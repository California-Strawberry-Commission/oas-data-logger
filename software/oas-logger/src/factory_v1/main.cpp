#include <Arduino.h>
#include <WiFiManager.h>

#include "DeviceAuth.h"
#include "certs/certs.h"
#include "ota_updater/ota_updater.h"

// Serial
const unsigned long SERIAL_BAUD_RATE{115200};

// Input pins
const gpio_num_t PIN_USER_BUTTON{GPIO_NUM_0};

// Rev 2 passive common - anode RGB LED
const gpio_num_t PIN_LED_R{GPIO_NUM_40};
const gpio_num_t PIN_LED_G{GPIO_NUM_38};
const gpio_num_t PIN_LED_B{GPIO_NUM_39};

constexpr int LEDC_CH_R{0};
constexpr int LEDC_CH_G{1};
constexpr int LEDC_CH_B{2};
constexpr int LEDC_FREQ{5000};
constexpr int LEDC_RES{8};
constexpr uint8_t LED_MAX_DUTY{20};

struct LedColor {
  uint8_t r;
  uint8_t g;
  uint8_t b;
};

constexpr LedColor LED_OFF{0, 0, 0};
constexpr LedColor LED_WHITE{255, 255, 255};
constexpr LedColor LED_RED{255, 0, 0};
constexpr LedColor LED_GREEN{0, 255, 0};
constexpr LedColor LED_BLUE{0, 0, 255};
constexpr LedColor LED_YELLOW{255, 255, 0};
constexpr LedColor LED_ORANGE{255, 80, 0};

static bool ledcAttached{false};

static void ledcAttachAll() {
  if (ledcAttached) return;

  ledcSetup(LEDC_CH_R, LEDC_FREQ, LEDC_RES);
  ledcSetup(LEDC_CH_G, LEDC_FREQ, LEDC_RES);
  ledcSetup(LEDC_CH_B, LEDC_FREQ, LEDC_RES);

  ledcAttachPin(PIN_LED_R, LEDC_CH_R);
  ledcAttachPin(PIN_LED_G, LEDC_CH_G);
  ledcAttachPin(PIN_LED_B, LEDC_CH_B);

  ledcAttached = true;
}

static void ledcDetachAll() {
  if (!ledcAttached) return;

  ledcDetachPin(PIN_LED_R);
  ledcDetachPin(PIN_LED_G);
  ledcDetachPin(PIN_LED_B);

  ledcAttached = false;
}

static void setLedColor(LedColor color) {
  static LedColor lastColor = {0, 0, 0};

  if (color.r == lastColor.r && color.g == lastColor.g &&
      color.b == lastColor.b) {
    return;
  }
  lastColor = color;

  if (color.r == 0 && color.g == 0 && color.b == 0) {
    ledcDetachAll();

    pinMode(PIN_LED_R, OUTPUT);
    pinMode(PIN_LED_G, OUTPUT);
    pinMode(PIN_LED_B, OUTPUT);

    digitalWrite(PIN_LED_R, HIGH);
    digitalWrite(PIN_LED_G, HIGH);
    digitalWrite(PIN_LED_B, HIGH);

    return;
  }

  ledcAttachAll();

  const uint16_t r = static_cast<uint16_t>(color.r) * LED_MAX_DUTY / 255;
  const uint16_t g = static_cast<uint16_t>(color.g) * LED_MAX_DUTY / 255;
  const uint16_t b = static_cast<uint16_t>(color.b) * LED_MAX_DUTY / 255;

  // 8-bit common anode LED, 256 = 0 in 8 bit which is off, 255 is full
  // brightness.
  ledcWrite(LEDC_CH_R, 256 - r);
  ledcWrite(LEDC_CH_G, 256 - g);
  ledcWrite(LEDC_CH_B, 256 - b);
}

// Security and Provisioning
char deviceUid[13]{0};     // Populated at boot
char deviceSecret[65]{0};  // Populated from NVS at boot

// Backend endpoints
const char* OTA_MANIFEST_ENDPOINT{
    "https://oas-data-logger.vercel.app/api/ota/manifest/%s/%s"};
const char* OTA_FIRMWARE_ENDPOINT{
    "https://oas-data-logger.vercel.app/api/ota/firmware/%s/%s/%d"};

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
    Serial.println("[WiFi] Resetting WiFi settings");
    wifiManager.resetSettings();
  }

  // Automatically connect using saved credentials. If there are no existing
  // credentials or connection fails, start an access point. If configuration
  // fails for whatever reason, then restart the device. Note that this blocks
  // until configuration is complete.
  if (!wifiManager.autoConnect()) {
    Serial.println("[WiFi] WiFi failed to connect. Restarting device...");
    ESP.restart();
  } else {
    Serial.println("[WiFi] WiFi connected");
    setLedColor(LED_YELLOW);
  }
}

static void provisionDevice() {
  // Set device UID
  uint64_t raw = ESP.getEfuseMac();
  snprintf(deviceUid, sizeof(deviceUid), "%012llX", (unsigned long long)raw);

  // Load device secret
  device_auth::DeviceAuth auth(deviceUid);
  auth.loadSecretOrProvision(deviceSecret, sizeof(deviceSecret), true);

  Serial.println("Device provisioning verified.");
}

static void runOtaUpdate() {
  ota::OtaUpdater::Config otaConfig;
  snprintf(otaConfig.manifestEndpoint, sizeof(otaConfig.manifestEndpoint), "%s",
           OTA_MANIFEST_ENDPOINT);
  snprintf(otaConfig.firmwareEndpoint, sizeof(otaConfig.firmwareEndpoint), "%s",
           OTA_FIRMWARE_ENDPOINT);
  snprintf(otaConfig.deviceType, sizeof(otaConfig.deviceType), "%s",
           DEVICE_TYPE);
  snprintf(otaConfig.channel, sizeof(otaConfig.channel), "%s", OTA_CHANNEL);
  otaConfig.currentBuildNumber = FW_BUILD_NUMBER;
  snprintf(otaConfig.deviceId, sizeof(otaConfig.deviceId), "%s", deviceUid);
  snprintf(otaConfig.deviceSecret, sizeof(otaConfig.deviceSecret), "%s",
           deviceSecret);
  otaConfig.caCert = vercel_root_ca_pem_start;
  otaConfig.redirectCaCert = s3_root_ca_pem_start;
  ota::OtaUpdater otaUpdater(otaConfig);
  auto res{otaUpdater.updateIfAvailable(true)};
  if (res.ok) {
    setLedColor(LED_GREEN);
  } else {
    Serial.printf("[OTA] Error when updating firmware: %s\n", res.message);
    setLedColor(LED_ORANGE);
  }
}

void setup() {
  setLedColor(LED_RED);

  Serial.begin(SERIAL_BAUD_RATE);

  // Read to indicate whether the user button is pressed
  pinMode(PIN_USER_BUTTON, INPUT_PULLUP);

  // Add delay to give dev some time to connect to Serial Monitor
  vTaskDelay(pdMS_TO_TICKS(1000));

  connectWifiWithPortal();

  Serial.printf("Firmware: version=%s build=%d device=%s channel=%s\n",
                FW_VERSION, FW_BUILD_NUMBER, DEVICE_TYPE, OTA_CHANNEL);

  provisionDevice();
  runOtaUpdate();
}

void loop() { delay(1000); }