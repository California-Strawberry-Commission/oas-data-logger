#include "dlflib/auth/request_signer.h"

#include "mbedtls/md.h"

/**
 * RequestSigner Implementation
 *
 * PURPOSE:
 * Implements the cryptographic logic required to authenticate this device
 * with the backend API. It uses the ESP32's hardware-accelerated mbedtls
 * library to perform SHA-256 hashing and HMAC signing.
 *
 * WORKFLOW:
 * 1. SETUP: Instantiate the RequestSigner with the provisioned Device ID
 * and Secret (passed directly to the constructor).
 * 2. SIGNING: Before sending an HTTP request, call writeAuthHeaders().
 * - Captures the current timestamp (requires NTP sync beforehand).
 * - Generates a random nonce using esp_random().
 * - Hashes the payload (SHA-256).
 * - Computes the signature: HMAC(Secret, "ID:Timestamp:Nonce:BodyHash").
 * 3. OUTPUT: Automatically writes the 'x-signature', 'x-timestamp', and
 * other security headers directly to the open WiFiClient stream.
 */

namespace dlf::auth {

RequestSigner::RequestSigner(const char* deviceId, const char* secret) {
  strncpy(deviceId_, deviceId, sizeof(deviceId_) - 1);
  deviceId_[sizeof(deviceId_) - 1] = '\0';

  strncpy(secret_, secret, sizeof(secret_) - 1);
  secret_[sizeof(secret_) - 1] = '\0';
}

bool RequestSigner::writeAuthHeaders(WiFiClient& client, const char* payload) {
  if (deviceId_[0] == '\0' || secret_[0] == '\0') {
    return false;
  }

  time_t now;
  time(&now);

  char timestamp[24];
  snprintf(timestamp, sizeof(timestamp), "%lld", (long long)now);

  char nonce[16];
  snprintf(nonce, sizeof(nonce), "%lu", (unsigned long)esp_random());

  char bodyHash[65];
  sha256(payload, bodyHash, sizeof(bodyHash));

  char stringToSign[256];
  snprintf(stringToSign, sizeof(stringToSign), "%s:%s:%s:%s", deviceId_,
           timestamp, nonce, bodyHash);

  char signature[65];
  hmacSha256(secret_, stringToSign, signature, sizeof(signature));

  client.printf("x-device-id: %s\r\n", deviceId_);
  client.printf("x-timestamp: %s\r\n", timestamp);
  client.printf("x-nonce: %s\r\n", nonce);
  client.printf("x-signature: %s\r\n", signature);

  return true;
}

bool RequestSigner::writeAuthHeaders(HTTPClient& client, const char* payload) {
  if (deviceId_[0] == '\0' || secret_[0] == '\0') {
    return false;
  }

  time_t now;
  time(&now);

  char timestamp[24];
  snprintf(timestamp, sizeof(timestamp), "%lld", (long long)now);

  char nonce[16];
  snprintf(nonce, sizeof(nonce), "%lu", (unsigned long)esp_random());

  char bodyHash[65];
  sha256(payload, bodyHash, sizeof(bodyHash));

  char stringToSign[256];
  snprintf(stringToSign, sizeof(stringToSign), "%s:%s:%s:%s", deviceId_,
           timestamp, nonce, bodyHash);

  char signature[65];
  hmacSha256(secret_, stringToSign, signature, sizeof(signature));

  client.addHeader("x-device-id", deviceId_);
  client.addHeader("x-timestamp", timestamp);
  client.addHeader("x-nonce", nonce);
  client.addHeader("x-signature", signature);

  return true;
}

void RequestSigner::sha256(const char* data, char* outHex, size_t outSize) {
  byte result[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)data, strlen(data));
  mbedtls_md_finish(&ctx, result);
  mbedtls_md_free(&ctx);

  outHex[0] = '\0';
  for (int i = 0; i < 32 && (size_t)(i * 2 + 2) < outSize; i++) {
    snprintf(outHex + (i * 2), 3, "%02x", result[i]);
  }
}

void RequestSigner::hmacSha256(const char* key, const char* data, char* outHex,
                               size_t outSize) {
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);  // 1 = HMAC
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)data, strlen(data));
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  outHex[0] = '\0';
  for (int i = 0; i < 32 && (size_t)(i * 2 + 2) < outSize; i++) {
    snprintf(outHex + (i * 2), 3, "%02x", hmacResult[i]);
  }
}

}  // namespace dlf::auth