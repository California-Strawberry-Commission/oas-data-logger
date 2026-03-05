#include "DeviceAuth.h"

/**
 * DeviceAuth.cpp
 *
 * PURPOSE:
 * Manages the persistence and initial setup of the device's security
 * credentials. This class handles:
 *
 * 1. Secure Storage: Reading/Writing the unique 32-byte hex secret to NVS.
 * 2. Provisioning: Implementing the handshake that pairs the device
 * with the database via the serial port.
 *
 * PROVISIONING FLOW (Blocking):
 * If loadSecret() returns false on boot, the device enters a BLOCKING loop
 * inside awaitProvisioning().
 * 1. Device broadcasts: "DEVICE_ID:<id>" every 1s.
 * 2. Host script detects ID, generates secret, and sends: "PROV_SET:<secret>".
 * 3. Device validates, saves to NVS, and reboots/continues.
 *
 * DEPENDENCIES:
 * - Preferences: For persistent storage (NVS) under the "oas_config" namespace.
 */

namespace device_auth {

DeviceAuth::DeviceAuth(const char* deviceId) {
  snprintf(deviceId_, sizeof(deviceId_), "%s", deviceId);
}

bool DeviceAuth::loadSecretOrProvision(char* secretBuffer, size_t secretLen,
                                       bool rebootOnProvision) {
  if (loadSecret(secretBuffer, secretLen)) {
    Serial.println("[Auth] Device already provisioned.");
    return true;
  }

  Serial.println("[Auth] Device unprovisioned. Waiting for script...");
  awaitProvisioning(secretBuffer, secretLen);

  Serial.println("[Auth] Provisioning successful.");

  if (rebootOnProvision) {
    Serial.println("[Auth] Rebooting in 3s...");
    delay(3000);
    ESP.restart();
  }

  return true;
}

bool DeviceAuth::loadSecret(char* secretBuffer, size_t secretLen) {
  Preferences preferences;
  preferences.begin(PREF_NAMESPACE, true);  // Read-only
  size_t len = preferences.getString(PREF_KEY_SECRET, secretBuffer, secretLen);
  preferences.end();

  return len > 0;
}

void DeviceAuth::saveSecret(const char* secret) {
  Preferences preferences;
  preferences.begin(PREF_NAMESPACE, false);  // Read-Write
  preferences.putString(PREF_KEY_SECRET, secret);
  preferences.end();
}

bool DeviceAuth::awaitProvisioning(char* secretBuffer, size_t secretLen) {
  Serial.println("[Auth] Waiting for command: PROV_SET:<SECRET>");

  // !!! BLOCKING LOOP !!!
  // The device will NOT exit this loop until a valid secret is sent.
  while (true) {
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 1000) {
      lastPrint = millis();
      Serial.printf("DEVICE_ID:%s\n", deviceId_);
    }

    if (Serial.available()) {
      char input[128];
      size_t len = Serial.readBytesUntil('\n', input, sizeof(input) - 1);
      input[len] = '\0';

      if (len > 0 && input[len - 1] == '\r') {
        input[len - 1] = '\0';
      }

      if (strncmp(input, "PROV_SET:", 9) == 0) {
        const char* newSecret =
            input + 9;  // PROV_SET: is 9 characters long, skip to secret.
        size_t newSecretLen = strlen(newSecret);

        // This validates the length is 64 chars and strspn returns a count of
        // valid chars, i.e. 64 if all are valid hex.
        if (newSecretLen == 64 &&
            strspn(newSecret, "0123456789abcdefABCDEF") == 64) {
          saveSecret(newSecret);
          Serial.println("PROV_SUCCESS");
          delay(1000);

          snprintf(secretBuffer, secretLen, "%s", newSecret);

          return true;
        } else {
          Serial.println("PROV_FAIL: Invalid Length");
        }
      }
    }
    delay(10);
  }
}
}  // namespace device_auth