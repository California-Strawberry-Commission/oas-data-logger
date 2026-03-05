#pragma once
#include <Arduino.h>
#include <Preferences.h>

namespace device_auth {

constexpr const char* PREF_NAMESPACE = "oas_config";
constexpr const char* PREF_KEY_SECRET = "secret";

class DeviceAuth {
 public:
  DeviceAuth(const char* deviceId);

  bool loadSecret(char* secretBuffer, size_t secretLen);

  bool awaitProvisioning(char* secretBuffer, size_t secretLen);

  bool loadSecretOrProvision(char* secretBuffer, size_t secretLen,
                             bool rebootOnProvision = true);

 private:
  char deviceId_[65];

  void saveSecret(const char* secret);
};
}  // namespace device_auth