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

DeviceAuth::DeviceAuth(String deviceId) { deviceId_ = deviceId; }

bool DeviceAuth::loadSecret(String& secretBuffer) {
  Preferences preferences;
  preferences.begin(PREF_NAMESPACE, true);  // Read-only
  String s = preferences.getString(PREF_KEY_SECRET, "");
  preferences.end();

  if (s.length() > 0) {
    secretBuffer = s;
    return true;
  }
  return false;
}

void DeviceAuth::saveSecret(const String& secret) {
  Preferences preferences;
  preferences.begin(PREF_NAMESPACE, false);  // Read-Write
  preferences.putString(PREF_KEY_SECRET, secret);
  preferences.end();
}

String DeviceAuth::awaitProvisioning() {
  Serial.println("[Auth] Waiting for command: PROV_SET:<SECRET>");

  // !!! BLOCKING LOOP !!!
  // The device will NOT exit this loop until a valid secret is sent.
  while (true) {
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 1000) {
      lastPrint = millis();
      Serial.printf("DEVICE_ID:%s\n", deviceId_.c_str());
    }

    if (Serial.available()) {
      String input = Serial.readStringUntil('\n');
      input.trim();

      if (input.startsWith("PROV_SET:")) {
        String newSecret = input.substring(9);

        // This validates the length is 64 chars and strspn returns a count of
        // valid chars, i.e. 64 if all are valid hex.
        if (newSecret.length() == 64 &&
            strspn(newSecret.c_str(), "0123456789abcdefABCDEF") == 64) {
          saveSecret(newSecret);
          Serial.println("PROV_SUCCESS");
          delay(1000);
          return newSecret;
        } else {
          Serial.println("PROV_FAIL: Invalid Length");
        }
      }
    }
    delay(10);
  }
}
}  // namespace device_auth