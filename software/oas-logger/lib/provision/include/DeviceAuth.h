#pragma once
#include <Arduino.h>
#include <Preferences.h>

namespace device_auth {

constexpr const char* PREF_NAMESPACE = "oas_config";
constexpr const char* PREF_KEY_SECRET = "secret";

class DeviceAuth {
 public:
  DeviceAuth(const char* deviceId);

  bool loadSecretOrProvision(char* secretBuffer, size_t secretBufferLen,
                             bool rebootOnProvision = true);

 private:
  char deviceId_[65];

  // secretBuffer must have room for 65 bytes at minimum
  // 64 for secret + 1 for null terminator
  bool loadSecret(char* secretBuffer, size_t secretBufferLen);

  bool awaitProvisioning(char* secretBuffer, size_t secretBufferLen);

  void saveSecret(const char* secret);

  bool readSerialInput(char* input, size_t inputLen);

  bool isValidSecret(const char* secret, size_t secretLen);

  bool exportProvisionedSecret(const char* secretBuffer,
                               size_t secretBufferLen);
};
}  // namespace device_auth