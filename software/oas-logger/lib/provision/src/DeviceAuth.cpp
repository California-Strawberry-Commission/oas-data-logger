#include "DeviceAuth.h"

/**
 * DeviceAuth.cpp
 *
 * PURPOSE:
 * Manages the persistence, initial setup of the device's security
 * credentials, and exporting of existing device seucrity credentials. This
 * class handles:
 *
 * 1. Secure Storage: Reading/Writing the unique 32-byte hex secret to NVS.
 * 2. Provisioning: Implementing the handshake that pairs the device
 * with the database via the serial port.
 * 3. Credential Export: Allows an already provisioned device to briefly expose
 * its existing ID and secret over serial when requested by the provisioning
 * script.
 *
 * PROVISIONING FLOW (Blocking):
 * If loadSecret() returns false on boot, the device enters a BLOCKING loop
 * inside awaitProvisioning().
 * 1. Device broadcasts: "DEVICE_ID:<id>" every 1s.
 * 2. Host script detects ID, generates secret, and sends: "PROV_SET:<secret>".
 * 3. Device validates, saves to NVS, and reboots/continues.
 *
 * PROVISIONING FLOW (Timed):
 * If loadSecret() returns true on boot, the device briefly listens for
 * "PROV_GET" inside exportProvisionedSecret().
 * 1. Host script sends: "PROV_GET".
 * 2. Device validates the stored secret.
 * 3. Device responds with:
 *      - "DEVICE_ID:<id>"
 *      - "PROV_SECRET:<secret>"
 * 4. If no request is received, boot continues without exposing secret.
 *
 * DEPENDENCIES:
 * - Preferences: For persistent storage (NVS) under the "oas_config" namespace.
 */

namespace device_auth {

DeviceAuth::DeviceAuth(const char* deviceId) {
  snprintf(deviceId_, sizeof(deviceId_), "%s", deviceId);
}

bool DeviceAuth::readSerialInput(char* input, size_t inputLen) {
  if (!Serial.available() || inputLen == 0) {
    return false;
  }

  size_t len = Serial.readBytesUntil('\n', input, inputLen - 1);
  input[len] = '\0';

  if (len > 0 && input[len - 1] == '\r') {
    input[len - 1] = '\0';
  }

  return len > 0;
}

bool DeviceAuth::isValidSecret(const char* secret, size_t secretLen) {
  return newSecretLen == 64 &&
         strspn(newSecret, "0123456789abcdefABCDEF") == 64;
}

bool DeviceAuth::exportProvisionedSecret(const char* secretBuffer,
                                         size_t secretBufferLen) {
  Serial.println("[Auth] Listening for PROV_GET");
  unsigned long start = millis();

  while (millis() - start < 5000) {
    char input[32];
    if (readSerialInput(input, sizeof(input))) {
      if (strcmp(input, "PROV_GET") == 0) {
        size_t secretLen = strnlen(secretBuffer, secretBufferLen);

        if (!isValidSecret(secretBuffer, secretLen)) {
          Serial.println("PROV_FAIL: Stored secret invalid");
          return false;
        }

        Serial.printf("DEVICE_ID:%s\n", deviceId_);
        Serial.printf("PROV_SECRET:%s\n", secretBuffer);
        return true;
      }
    }

    delay(10);
  }

  return false;
}

bool DeviceAuth::loadSecretOrProvision(char* secretBuffer,
                                       size_t secretBufferLen,
                                       bool rebootOnProvision) {
  if (loadSecret(secretBuffer, secretBufferLen)) {
    Serial.println("[Auth] Device already provisioned.");
    // Export is optional, a timeout should not block normal boot.
    exportProvisionedSecret(secretBuffer, secretBufferLen);
    return true;
  }

  Serial.println("[Auth] Device unprovisioned. Waiting for script...");
  awaitProvisioning(secretBuffer, secretBufferLen);

  Serial.println("[Auth] Provisioning successful.");

  if (rebootOnProvision) {
    Serial.println("[Auth] Rebooting in 3s...");
    delay(3000);
    ESP.restart();
  }

  return true;
}

bool DeviceAuth::loadSecret(char* secretBuffer, size_t secretBufferLen) {
  Preferences preferences;
  preferences.begin(PREF_NAMESPACE, true);  // Read-only
  size_t len =
      preferences.getString(PREF_KEY_SECRET, secretBuffer, secretBufferLen);
  preferences.end();

  return len > 0;
}

void DeviceAuth::saveSecret(const char* secret) {
  Preferences preferences;
  preferences.begin(PREF_NAMESPACE, false);  // Read-Write
  preferences.putString(PREF_KEY_SECRET, secret);
  preferences.end();
}

bool DeviceAuth::awaitProvisioning(char* secretBuffer, size_t secretBufferLen) {
  Serial.println("[Auth] Waiting for command: PROV_SET:<SECRET>");

  // !!! BLOCKING LOOP !!!
  // The device will NOT exit this loop until a valid secret is sent.
  unsigned long lastPrint = 0;
  while (true) {
    if (millis() - lastPrint > 1000) {
      lastPrint = millis();
      Serial.printf("DEVICE_ID:%s\n", deviceId_);
    }

    char input[128];

    if (readSerialInput(input, sizeof(input))) {
      if (strncmp(input, "PROV_SET:", 9) == 0) {
        const char* newSecret =
            input + 9;  // PROV_SET: is 9 characters long, skip to secret.
        size_t newSecretLen = strlen(newSecret);

        if (isValidSecret(newSecret, newSecretLen)) {
          saveSecret(newSecret);
          Serial.println("PROV_SUCCESS");
          delay(1000);

          snprintf(secretBuffer, secretBufferLen, "%s", newSecret);

          return true;
        } else {
          Serial.println("PROV_FAIL: Invalid Secret");
        }
      }
    }

    delay(10);
  }
}
}  // namespace device_auth