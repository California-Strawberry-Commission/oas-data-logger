#pragma once

#include <Arduino.h>
#include <WiFiClient.h>

class RequestSigner {
 public:
  void setCredentials(String deviceId, String secret);
  bool writeAuthHeaders(WiFiClient& client, const String& payload);

 private:
  String deviceId_;
  String secret_;

  String sha256(String data);
  String hmacSha256(String key, String payload);
};