#pragma once
#include <Arduino.h>
#include <Preferences.h>

namespace device_auth {

constexpr const char* PREF_NAMESPACE = "oas_config";
constexpr const char* PREF_KEY_SECRET = "secret";

class DeviceAuth {
 public:
  DeviceAuth(const String& deviceId);

  bool loadSecret(String& secretBuffer);

  String awaitProvisioning();

 private:
  String deviceId_;

  void saveSecret(const String& secret);
};
}  // namespace device_auth