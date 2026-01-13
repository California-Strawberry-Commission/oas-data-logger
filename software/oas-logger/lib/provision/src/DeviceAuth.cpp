#include "DeviceAuth.h"

/**
 * DeviceAuth.cpp
 * * * PURPOSE:
 * Manages the security lifecycle of the IoT device. This includes:
 * 1. Secure Storage: Saving the unique device secret to NVS (Non-Volatile
 * Storage).
 * 2. Provisioning: Listening for serial commands to set the initial secret.
 * 3. Request Signing: Generating HMAC-SHA256 signatures for API requests.
 * * * PROVISIONING FLOW (Blocking):
 * If no secret is found in NVS on boot, the device enters a BLOCKING loop.
 * It broadcasts "DEVICE_ID:<id>" over Serial and waits for "PROV_SET:<secret>".
 * Once received, the secret is saved, and the device continues booting.
 * * * SECURITY ARCHITECTURE:
 * - Secret Storage: Stored in ESP32 Preferences (NVS) under namespace
 * "oas_config".
 * - Network Security: The secret is never sent over the network.
 * It is used only as a key to sign payloads.
 * * * SIGNATURE ALGORITHM (Must match Server):
 * Signature = HMAC_SHA256(Key=DeviceSecret, Data=StringToSign)
 * StringToSign = DeviceID + ":" + Timestamp + ":" + Nonce + ":" +
 * SHA256(Payload)
 * * * DEPENDENCIES:
 * - mbedtls: For SHA256 and HMAC cryptographic functions.
 * - Preferences: For persistent storage.
 */

DeviceAuth::DeviceAuth(String deviceId, String secret) {
  _deviceId = deviceId;
  _secret = secret;
}

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
  Serial.println("[Auth] NO SECRET FOUND - Device unprovisioned");
  Serial.println("[Auth] Waiting for command: PROV_SET:<SECRET>");

  // !!! BLOCKING LOOP !!!
  // The device will NOT exit this loop until a valid secret is sent.
  while (true) {
    // 1. Announce presence (helper for scripts to find us)
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 1000) {
      lastPrint = millis();
      // Ensure _deviceId is accessible here
      Serial.printf("DEVICE_ID:%s\n", _deviceId);
    }

    // 2. Check for Command
    if (Serial.available()) {
      String input = Serial.readStringUntil('\n');
      input.trim();

      if (input.startsWith("PROV_SET:")) {
        String newSecret = input.substring(9);  // Strip prefix

        if (newSecret.length() >= 16) {
          saveSecret(
              newSecret);  // Assumes saveSecret is a private member function
          Serial.println("PROV_SUCCESS");
          delay(1000);
          return newSecret;  // Return to break loop and continue boot
        } else {
          Serial.println("PROV_FAIL: Invalid Length");
        }
      }
    }
    delay(10);  // Small yield
  }
}

AuthHeaders DeviceAuth::signPayload(String payload) {
  // Ensure you use a GPS or NTP sync before calling this.
  time_t now;
  time(&now);
  String timestamp = String(now);

  // 2. Generate Nonce (Random number)
  String nonce = String(esp_random());

  // 3. Hash the Body
  String bodyHash = sha256(payload);

  // 4. Compute Signature
  // Format: DeviceID:Timestamp:Nonce:BodyHash
  String stringToSign =
      _deviceId + ":" + timestamp + ":" + nonce + ":" + bodyHash;
  String signature = hmacSha256(_secret, stringToSign);

  return {_deviceId, timestamp, nonce, signature};
}

String DeviceAuth::sha256(String data) {
  byte result[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_finish(&ctx, result);
  mbedtls_md_free(&ctx);

  String hashStr = "";
  for (int i = 0; i < 32; i++) {
    if (result[i] < 16) hashStr += "0";
    hashStr += String(result[i], HEX);
  }
  hashStr.toUpperCase();
  return hashStr;
}

String DeviceAuth::hmacSha256(String key, String payload) {
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);  // 1 = HMAC
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key.c_str(), key.length());
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload.c_str(),
                         payload.length());
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  String signature = "";
  for (int i = 0; i < 32; i++) {
    if (hmacResult[i] < 16) signature += "0";
    signature += String(hmacResult[i], HEX);
  }
  signature.toUpperCase();
  return signature;
}