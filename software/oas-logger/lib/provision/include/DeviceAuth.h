#pragma once
#include <Arduino.h>
#include <Preferences.h>

#define PREF_NAMESPACE "oas_config"
#define PREF_KEY_SECRET "secret"

class DeviceAuth {
 public:
  DeviceAuth(String deviceId);

  bool loadSecret(String& secretBuffer);

  String awaitProvisioning();

 private:
  String deviceId_;

  void saveSecret(const String& secret);
};