#pragma once

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

namespace dlf::auth {

class RequestSigner {
 public:
  RequestSigner(const char* deviceId, const char* secret);
  bool writeAuthHeaders(WiFiClient& client, const char* payload = "");
  bool writeAuthHeaders(HTTPClient& client, const char* payload = "");

 private:
  char deviceId_[64];
  char secret_[65];

  void sha256(const char* data, char* outHex, size_t outSize);
  void hmacSha256(const char* key, const char* data, char* outHex,
                  size_t outSize);
};

}  // namespace dlf::auth