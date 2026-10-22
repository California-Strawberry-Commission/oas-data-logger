#pragma once

#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include <memory>

#include "dlflib/util/util.h"

namespace dlf::util {

// We must be sure to end the HTTPClient to avoid memory and socket leaks.
// Instead of manually calling HTTPClient::end everywhere, use this RAII guard.
struct HTTPClientGuard {
  HTTPClient& client;
  explicit HTTPClientGuard(HTTPClient& h) : client(h) {}

  HTTPClientGuard(const HTTPClientGuard&) = delete;
  HTTPClientGuard& operator=(const HTTPClientGuard&) = delete;
  HTTPClientGuard(HTTPClientGuard&&) = delete;
  HTTPClientGuard& operator=(HTTPClientGuard&&) = delete;

  ~HTTPClientGuard() { client.end(); }
};

/**
 * Create a WiFiClient, or a WiFiClientSecure if secure.
 *
 * @param caCert PEM-encoded CA certificate. If nullptr, certificate validation
 * is skipped (insecure).
 */
inline std::unique_ptr<WiFiClient> createWiFiClient(
    bool secure, const char* caCert = nullptr) {
  if (secure) {
    auto secureClient{make_unique<WiFiClientSecure>()};
    if (caCert != nullptr) {
      secureClient->setCACert(caCert);
    } else {
      secureClient->setInsecure();
    }
    return std::unique_ptr<WiFiClient>(secureClient.release());
  }

  return make_unique<WiFiClient>();
}

}  // namespace dlf::util
