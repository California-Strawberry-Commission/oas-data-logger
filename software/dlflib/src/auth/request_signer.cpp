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

RequestSigner::RequestSigner(const String& deviceId, const String& secret)
    : deviceId_(deviceId), secret_(secret) {}

bool RequestSigner::writeAuthHeaders(WiFiClient& client,
                                     const String& payload) {
  if (deviceId_.isEmpty() || secret_.isEmpty()) {
    return false;
  }

  time_t now;
  time(&now);
  String timestamp = String(now);
  String nonce = String(esp_random());

  String bodyHash = sha256(payload);

  String stringToSign =
      deviceId_ + ":" + timestamp + ":" + nonce + ":" + bodyHash;
  String signature = hmacSha256(secret_, stringToSign);

  client.printf("x-device-id: %s\r\n", deviceId_.c_str());
  client.printf("x-timestamp: %s\r\n", timestamp.c_str());
  client.printf("x-nonce: %s\r\n", nonce.c_str());
  client.printf("x-signature: %s\r\n", signature.c_str());

  return true;
}

bool RequestSigner::writeAuthHeaders(HTTPClient& client,
                                     const String& payload) {
  if (deviceId_.isEmpty() || secret_.isEmpty()) {
    return false;
  }

  time_t now;
  time(&now);
  String timestamp = String(now);
  String nonce = String(esp_random());

  String bodyHash = sha256(payload);

  String stringToSign =
      deviceId_ + ":" + timestamp + ":" + nonce + ":" + bodyHash;

  String signature = hmacSha256(secret_, stringToSign);

  client.addHeader("x-device-id", deviceId_);
  client.addHeader("x-timestamp", timestamp);
  client.addHeader("x-nonce", nonce);
  client.addHeader("x-signature", signature);

  return true;
}

String RequestSigner::sha256(const String& data) {
  byte result[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_finish(&ctx, result);
  mbedtls_md_free(&ctx);

  String hashStr = "";
  for (int i = 0; i < 32; i++) {
    if (result[i] < 16) hashStr += "0";
    hashStr += String(result[i], HEX);
  }

  return hashStr;
}

String RequestSigner::hmacSha256(const String& key, const String& payload) {
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);  // 1 = HMAC
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key.c_str(), key.length());
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload.c_str(),
                         payload.length());
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  String signature = "";
  for (int i = 0; i < 32; i++) {
    if (hmacResult[i] < 16) signature += "0";
    signature += String(hmacResult[i], HEX);
  }

  return signature;
}

}  // namespace dlf::auth