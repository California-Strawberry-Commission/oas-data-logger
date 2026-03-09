#pragma once
#include <Arduino.h>
#include <Preferences.h>

namespace device_auth {

constexpr const char* PREF_NAMESPACE = "oas_config";
constexpr const char* PREF_KEY_SECRET = "secret";

class DeviceAuth {
 public:
  DeviceAuth(const char* deviceId);

  // secretBuffer must have room for 65 bytes at minimum
  // 64 for secret + 1 for null terminator
  bool loadSecret(char* secretBuffer, size_t secretBufferLen);

  bool awaitProvisioning(char* secretBuffer, size_t secretBufferLen);

  bool loadSecretOrProvision(char* secretBuffer, size_t secretBufferLen,
                             bool rebootOnProvision = true);

 private:
  char deviceId_[65];

  void saveSecret(const char* secret);
};
}  // namespace device_auth