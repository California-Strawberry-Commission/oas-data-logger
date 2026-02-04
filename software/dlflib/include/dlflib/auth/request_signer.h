#pragma once

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

namespace dlf::auth {

class RequestSigner {
 public:
  RequestSigner(const String& deviceId, const String& secret);
  bool writeAuthHeaders(WiFiClient& client, const String& payload = "");
  bool writeAuthHeaders(HTTPClient& client, const String& payload = "");

 private:
  String deviceId_;
  String secret_;

  String sha256(const String& data);
  String hmacSha256(const String& key, const String& payload);
};

}  // namespace dlf::auth