#pragma once
#include <Arduino.h>
#include <Preferences.h>

#include "mbedtls/md.h"

#define PREF_NAMESPACE "oas_config"
#define PREF_KEY_SECRET "secret"

// Struct to hold the headers we need to send
struct AuthHeaders {
  String deviceId;
  String timestamp;
  String nonce;
  String signature;
};

class DeviceAuth {
 private:
  String _deviceId;
  String _secret;

  String sha256(String data);
  String hmacSha256(String key, String payload);

  void saveSecret(const String& secret);

 public:
  DeviceAuth(String deviceId, String secret);

  bool loadSecret(String& secretBuffer);

  String awaitProvisioning();

  AuthHeaders signPayload(String payload);
};