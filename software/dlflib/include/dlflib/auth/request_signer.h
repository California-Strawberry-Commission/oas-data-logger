#pragma once

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

namespace dlf::auth {

class RequestSigner {
 public:
  RequestSigner(const char* deviceId, const char* secret);
  bool writeAuthHeaders(WiFiClient& client, const char* payload = nullptr);
  bool writeAuthHeaders(HTTPClient& client, const char* payload = nullptr);

 private:
  char deviceId_[65];
  char secret_[65];

  void sha256(const char* data, size_t dataLen, char* outHex, size_t outSize);
  void hmacSha256(const char* key, size_t keyLen, const char* data,
                  size_t dataLen, char* outHex, size_t outSize);
  static void bytesToHex(const byte* bytes, size_t len, char* outHex,
                         size_t outSize);
};

}  // namespace dlf::auth