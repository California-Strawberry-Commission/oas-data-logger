#include "ota_updater/ota_updater.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>
#include <dlflib/util/util.h>
#include <mbedtls/sha256.h>

namespace {

bool bytesToHexLower(const uint8_t* bytes, size_t len, char* out,
                     size_t outSize) {
  static constexpr char HEX_MAP[]{"0123456789abcdef"};

  if (!bytes || !out || outSize < (len * 2 + 1)) {
    return false;
  }

  for (size_t i = 0; i < len; ++i) {
    out[i * 2] = HEX_MAP[(bytes[i] >> 4) & 0x0F];
    out[i * 2 + 1] = HEX_MAP[bytes[i] & 0x0F];
  }
  out[len * 2] = '\0';
  return true;
}

bool copyStr(char* dst, size_t dstSize, const char* src) {
  if (!dst || dstSize == 0) {
    return false;
  }

  if (!src) {
    dst[0] = '\0';
    return true;
  }

  const size_t srcLen{strlen(src)};
  if (srcLen >= dstSize) {
    dst[0] = '\0';
    return false;
  }

  memcpy(dst, src, srcLen + 1);
  return true;
}

bool hexEqualsIgnoreCase(const char* a, const char* b) {
  if (!a || !b) {
    return false;
  }

  while (*a && *b) {
    char ca{*a};
    char cb{*b};

    if (ca >= 'A' && ca <= 'Z') {
      ca = static_cast<char>(ca - 'A' + 'a');
    }
    if (cb >= 'A' && cb <= 'Z') {
      cb = static_cast<char>(cb - 'A' + 'a');
    }

    if (ca != cb) {
      return false;
    }
    ++a;
    ++b;
  }

  return *a == '\0' && *b == '\0';
}

struct WiFiClientHolder {
  WiFiClient* client;

  WiFiClientHolder(WiFiClient* c) : client(c) {}

  WiFiClientHolder(const WiFiClientHolder&) = delete;
  WiFiClientHolder& operator=(const WiFiClientHolder&) = delete;
  WiFiClientHolder(WiFiClientHolder&& other) noexcept : client(other.client) {
    other.client = nullptr;
  }

  WiFiClientHolder& operator=(WiFiClientHolder&& other) noexcept {
    if (this != &other) {
      delete client;
      client = other.client;
      other.client = nullptr;
    }
    return *this;
  }

  ~WiFiClientHolder() { delete client; }
};

WiFiClientHolder createWiFiClient(bool secure) {
  if (secure) {
    auto* secureClient{new WiFiClientSecure()};
    secureClient->setInsecure();  // TODO: replace with cert pinning
    return WiFiClientHolder{secureClient};
  }

  return WiFiClientHolder{new WiFiClient()};
}

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

// RAII guard for mbedtls sha256
struct Sha256Guard {
  mbedtls_sha256_context ctx;
  bool ok = false;

  Sha256Guard() {
    mbedtls_sha256_init(&ctx);
    if (mbedtls_sha256_starts_ret(&ctx, /*is224=*/0) == 0) {
      ok = true;
    }
  }

  Sha256Guard(const Sha256Guard&) = delete;
  Sha256Guard& operator=(const Sha256Guard&) = delete;
  Sha256Guard(Sha256Guard&&) = delete;
  Sha256Guard& operator=(Sha256Guard&&) = delete;

  ~Sha256Guard() {
    if (ok) {
      mbedtls_sha256_free(&ctx);
    }
  }

  bool update(const uint8_t* data, size_t len) {
    if (!ok) {
      return false;
    }
    return mbedtls_sha256_update_ret(&ctx, data, len) == 0;
  }

  bool finish(uint8_t out[32]) {
    if (!ok) {
      return false;
    }
    return mbedtls_sha256_finish_ret(&ctx, out) == 0;
  }
};

bool isRedirectCode(int code) {
  return code == 301 || code == 302 || code == 303 || code == 307 ||
         code == 308;
}

ota::OtaUpdater::ManifestResult manifestError(const char* fmt, ...) {
  ota::OtaUpdater::ManifestResult res;
  res.ok = false;

  va_list args;
  va_start(args, fmt);
  vsnprintf(res.message, sizeof(res.message), fmt, args);
  va_end(args);

  return res;
}

ota::OtaUpdater::UpdateResult updateError(const char* fmt, ...) {
  ota::OtaUpdater::UpdateResult res;
  res.ok = false;
  res.updateApplied = false;

  va_list args;
  va_start(args, fmt);
  vsnprintf(res.message, sizeof(res.message), fmt, args);
  va_end(args);

  return res;
}

}  // namespace

namespace ota {

OtaUpdater::OtaUpdater(const Config& cfg)
    : config_(cfg), signer_(config_.deviceId, config_.deviceSecret) {}

OtaUpdater::ManifestResult OtaUpdater::fetchLatestManifest() {
  if (WiFi.status() != WL_CONNECTED) {
    return manifestError("WiFi not connected");
  }

  // Create and parse manifest URL
  char manifestUrl[256]{0};
  if (!getManifestUrl(manifestUrl, sizeof(manifestUrl))) {
    return manifestError("Failed to build manifest URL");
  }
  dlf::util::UrlParts parts{dlf::util::parseUrl(manifestUrl)};
  if (!parts.ok) {
    return manifestError("Invalid manifest URL");
  }

  // Create HTTPClient
  const bool useHttps{strcmp(parts.scheme, "https") == 0};
  auto wifiClientHolder{createWiFiClient(useHttps)};
  if (!wifiClientHolder.client) {
    return manifestError("Failed to create WiFi client");
  }
  wifiClientHolder.client->setTimeout(config_.manifestTimeoutMs / 1000);
  HTTPClient httpClient;
  // Use an RAII guard to automatically end the HTTPClient when it goes out of
  // scope
  HTTPClientGuard httpClientGuard{httpClient};
  httpClient.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpClient.setTimeout(config_.manifestTimeoutMs);

  // Set up HTTP request for manifest
  if (!httpClient.begin(*wifiClientHolder.client, manifestUrl)) {
    return manifestError("HTTP begin failed (manifest)");
  }
  // Sign the request
  if (!signer_.writeAuthHeaders(httpClient)) {
    return manifestError("Failed to add auth headers (manifest)");
  }
  // Send the GET request
  const int code{httpClient.GET()};
  if (code <= 0) {
    return manifestError("HTTP GET failed (manifest): %s",
                         httpClient.errorToString(code).c_str());
  } else if (code != 200) {
    return manifestError("HTTP GET status (manifest): %d", code);
  }

  // Parse JSON from stream
  WiFiClient& stream{httpClient.getStream()};
  stream.setTimeout(config_.manifestTimeoutMs / 1000);

  // Skip everything until JSON start before attempting to deserialize
  while (stream.connected()) {
    int c{stream.peek()};
    if (c == '{' || c == '[') {
      break;
    }
    stream.read();  // discard junk
  }

  // Deserialize JSON
  JsonDocument jsonDoc;
  DeserializationError jsonErr{deserializeJson(jsonDoc, stream)};
  if (jsonErr) {
    return manifestError("Manifest JSON parse error: %s", jsonErr.c_str());
  }

  if (jsonDoc["latest"].isNull()) {
    return manifestError("No published firmware in manifest");
  }

  ManifestResult res;
  copyStr(res.manifest.deviceType, sizeof(res.manifest.deviceType),
          jsonDoc["deviceType"] | "");
  copyStr(res.manifest.channel, sizeof(res.manifest.channel),
          jsonDoc["channel"] | "");

  JsonObject latest{jsonDoc["latest"]};
  copyStr(res.manifest.version, sizeof(res.manifest.version),
          latest["version"] | "");
  res.manifest.buildNumber = latest["buildNumber"] | -1;
  copyStr(res.manifest.sha256, sizeof(res.manifest.sha256),
          latest["sha256"] | "");
  res.manifest.size = static_cast<size_t>(latest["size"] | 0);

  copyStr(res.message, sizeof(res.message), "Manifest fetched successfully");
  res.ok = true;
  return res;
}

bool OtaUpdater::isUpdateAvailable(const Manifest& manifest) const {
  if (config_.currentBuildNumber < 0 || manifest.buildNumber < 0) {
    return false;
  }

  return manifest.buildNumber > config_.currentBuildNumber;
}

OtaUpdater::UpdateResult OtaUpdater::updateIfAvailable(bool rebootOnSuccess) {
  auto manifestResult{fetchLatestManifest()};
  if (!manifestResult.ok) {
    return updateError("%s", manifestResult.message);
  }

  if (!isUpdateAvailable(manifestResult.manifest)) {
    OtaUpdater::UpdateResult updateResult;
    updateResult.ok = true;
    updateResult.updateApplied = false;
    updateResult.newBuildNumber = manifestResult.manifest.buildNumber;
    copyStr(updateResult.message, sizeof(updateResult.message),
            "Already up to date");
    return updateResult;
  }

  return downloadAndUpdate(manifestResult.manifest, rebootOnSuccess);
}

bool OtaUpdater::getManifestUrl(char* outUrl, size_t outUrlSize) const {
  if (!outUrl || outUrlSize == 0) {
    return false;
  }

  const int n{snprintf(outUrl, outUrlSize, config_.manifestEndpoint,
                       config_.deviceType, config_.channel)};
  return n > 0 && static_cast<size_t>(n) < outUrlSize;
}

bool OtaUpdater::getFirmwareUrl(int buildNumber, char* outUrl,
                                size_t outUrlSize) const {
  if (!outUrl || outUrlSize == 0) {
    return false;
  }

  const int n{snprintf(outUrl, outUrlSize, config_.firmwareEndpoint,
                       config_.deviceType, config_.channel, buildNumber)};
  return n > 0 && static_cast<size_t>(n) < outUrlSize;
}

OtaUpdater::UpdateResult OtaUpdater::downloadAndUpdate(const Manifest& manifest,
                                                       bool rebootOnSuccess) {
  if (WiFi.status() != WL_CONNECTED) {
    return updateError("WiFi not connected");
  }

  if (manifest.buildNumber < 0) {
    return updateError("Manifest missing buildNumber");
  }

  // Create firmware URL
  char firmwareUrl[512]{0};  // note: redirect URLs may be quite long
  if (!getFirmwareUrl(manifest.buildNumber, firmwareUrl, sizeof(firmwareUrl))) {
    return updateError("Failed to build firmware URL");
  }

  // Create HTTPClient
  HTTPClient httpClient;
  // Use an RAII guard to automatically end the HTTPClient when it goes out of
  // scope
  HTTPClientGuard httpClientGuard{httpClient};
  httpClient.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpClient.setTimeout(config_.firmwareTimeoutMs);
  // Ensure that we are able to follow redirect URLs in the Location header
  const char* headerKeys[]{"Location"};
  httpClient.collectHeaders(headerKeys, 1);

  // Follow any redirects to the final resource
  int code{0};
  // We need to keep wifiClientHolder alive for the entire time while httpClient
  // is in scope, so initialize it here.
  WiFiClientHolder wifiClientHolder{nullptr};
  for (int redirectCount = 0; redirectCount < 5; ++redirectCount) {
    // End any previous session before calling begin() again on same HTTPClient
    httpClient.end();

    // Create a separate WiFiClient for each hop as the redirect may switch
    // host/scheme
    dlf::util::UrlParts parts{dlf::util::parseUrl(firmwareUrl)};
    if (!parts.ok) {
      return updateError("Invalid firmware URL");
    }
    const bool useHttps{strcmp(parts.scheme, "https") == 0};
    wifiClientHolder = createWiFiClient(useHttps);
    if (!wifiClientHolder.client) {
      return updateError("Failed to create WiFi client");
    }

    // Set up HTTP request for firmware
    if (!httpClient.begin(*wifiClientHolder.client, firmwareUrl)) {
      return updateError("HTTP begin failed (firmware)");
    }
    // Sign the request
    if (!signer_.writeAuthHeaders(httpClient)) {
      return updateError("Failed to add auth headers (firmware)");
    }
    // Send the GET request
    code = httpClient.GET();
    if (code <= 0) {
      return updateError("HTTP GET failed (firmware): %s",
                         httpClient.errorToString(code).c_str());
    }

    if (!isRedirectCode(code)) {
      break;
    }

    // Go to next redirect hop
    const String location{httpClient.header("Location")};
    if (location.length() == 0) {
      return updateError(
          "HTTP redirect (firmware), code = %d, missing Location header", code);
    }
    location.toCharArray(firmwareUrl, sizeof(firmwareUrl));
  }

  if (isRedirectCode(code)) {
    return updateError("Too many redirects when fetching firmware");
  } else if (code != 200) {
    const String body{httpClient.getString()};
    if (body.length() > 0) {
      char bodyBuf[201];
      body.toCharArray(bodyBuf, sizeof(bodyBuf));
      return updateError("HTTP status (firmware): %d body: %s", code, bodyBuf);
    } else {
      return updateError("HTTP status (firmware): %d", code);
    }
  }

  // Validate content size
  int contentLen{httpClient.getSize()};
  if (manifest.size > 0 && contentLen > 0 &&
      static_cast<size_t>(contentLen) != manifest.size) {
    return updateError("Firmware size does not match manifest");
  }

  // Start OTA update
  if (!Update.begin(contentLen > 0 ? contentLen : UPDATE_SIZE_UNKNOWN)) {
    return updateError("Update.begin failed: %s", Update.errorString());
  }

  // Initialize SHA-256
  Sha256Guard sha;
  if (!sha.ok) {
    Update.abort();
    return updateError("SHA256 init failed");
  }

  // Stream body into Update, reading in chunks to avoid huge RAM use
  WiFiClient& stream{httpClient.getStream()};
  stream.setTimeout(
      config_.firmwareTimeoutMs);  // controls how long readBytes() blocks
  // Allocate the firmware download buffer on the heap to avoid hitting
  // stack limit
  const size_t BUF_SZ{2048};
  std::unique_ptr<uint8_t[]> buf{new (std::nothrow) uint8_t[BUF_SZ]};
  if (!buf) {
    Update.abort();
    return updateError("Failed to allocate firmware buffer");
  }
  size_t writtenTotal{0};

  uint32_t lastProgressMs{millis()};
  // Add some buffer to the socket/read timeout to tolerate network pauses when
  // downloading firmware
  const uint32_t STALL_TIMEOUT_MS{config_.firmwareTimeoutMs +
                                  config_.firmwareStallGraceMs};

  while (httpClient.connected() && stream.connected()) {
    int availableBytes{stream.available()};
    if (availableBytes <= 0) {
      if (millis() - lastProgressMs > STALL_TIMEOUT_MS) {
        Update.abort();
        return updateError("Firmware download stalled (no data)");
      }
      delay(1);
      continue;
    }

    size_t readBytes{stream.readBytes(
        buf.get(), static_cast<size_t>(min(availableBytes, (int)BUF_SZ)))};
    if (readBytes == 0) {
      // Stream timeout
      if (millis() - lastProgressMs > STALL_TIMEOUT_MS) {
        Update.abort();
        return updateError("Firmware read timed out");
      }
      continue;
    }

    lastProgressMs = millis();

    // Update SHA
    if (!sha.update(buf.get(), static_cast<size_t>(readBytes))) {
      Update.abort();
      return updateError("SHA256 update failed");
    }

    // Write to OTA partition
    size_t writtenBytes{
        Update.write(buf.get(), static_cast<size_t>(readBytes))};
    if (writtenBytes != static_cast<size_t>(readBytes)) {
      Update.abort();
      return updateError("Update.write failed: %s", Update.errorString());
    }
    writtenTotal += writtenBytes;

    // If we know the content length, stop once we reach it
    if (contentLen > 0 && writtenTotal >= static_cast<size_t>(contentLen)) {
      break;
    }
  }

  // Verify written bytes against content length
  if (contentLen > 0 && writtenTotal != static_cast<size_t>(contentLen)) {
    Update.abort();
    return updateError("Firmware download ended early");
  }

  // Finish SHA and validate
  uint8_t digest[32];
  if (!sha.finish(digest)) {
    Update.abort();
    return updateError("SHA256 finish failed");
  }
  char gotSha[65]{0};
  if (!bytesToHexLower(digest, sizeof(digest), gotSha, sizeof(gotSha))) {
    Update.abort();
    return updateError("Failed to encode SHA256");
  }
  if (!hexEqualsIgnoreCase(gotSha, manifest.sha256)) {
    Update.abort();
    return updateError("Firmware SHA256 mismatch");
  }

  // Finalize Update
  if (!Update.end(true)) {
    Update.abort();
    return updateError("Update.end failed: %s", Update.errorString());
  }
  if (!Update.isFinished()) {
    Update.abort();
    return updateError("Update not finished");
  }

  UpdateResult res;
  res.ok = true;
  res.updateApplied = true;
  res.newBuildNumber = manifest.buildNumber;
  copyStr(res.message, sizeof(res.message), "Update applied");

  if (rebootOnSuccess) {
    delay(200);
    ESP.restart();
  }

  return res;
}

}  // namespace ota