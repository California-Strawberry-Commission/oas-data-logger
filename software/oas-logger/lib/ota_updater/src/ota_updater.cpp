#include "ota_updater/ota_updater.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>

namespace {

struct UrlParts {
  String scheme;
  String host;
  uint16_t port;
  String path;
};

UrlParts parseUrl(const String& url) {
  UrlParts urlParts;
  int schemeEnd{url.indexOf("://")};
  if (schemeEnd < 0) {
    // Invalid URL
    return urlParts;
  }

  urlParts.scheme = url.substring(0, schemeEnd);

  int hostStart{schemeEnd + 3};
  int pathStart{url.indexOf('/', hostStart)};
  if (pathStart < 0) {
    pathStart = url.length();
  }

  int colonPos{url.indexOf(':', hostStart)};
  if (colonPos >= 0 && colonPos < pathStart) {
    // host:port
    urlParts.host = url.substring(hostStart, colonPos);
    urlParts.port = url.substring(colonPos + 1, pathStart).toInt();
  } else {
    // host, no explicit port
    urlParts.host = url.substring(hostStart, pathStart);
    urlParts.port = (urlParts.scheme == "https") ? 443 : 80;
  }

  urlParts.path = (pathStart < url.length()) ? url.substring(pathStart) : "/";
  return urlParts;
}

struct WiFiClientHolder {
  WiFiClient* client;
  bool secure;

  WiFiClientHolder(WiFiClient* c, bool isSecure)
      : client(c), secure(isSecure) {}

  WiFiClientHolder(const WiFiClientHolder&) = delete;
  WiFiClientHolder& operator=(const WiFiClientHolder&) = delete;
  WiFiClientHolder(WiFiClientHolder&& other) noexcept
      : client(other.client), secure(other.secure) {
    other.client = nullptr;
  }

  WiFiClientHolder& operator=(WiFiClientHolder&& other) noexcept {
    if (this != &other) {
      delete client;
      client = other.client;
      secure = other.secure;
      other.client = nullptr;
    }
    return *this;
  }

  ~WiFiClientHolder() { delete client; }
};

WiFiClientHolder createWiFiClient(const String& url) {
  UrlParts parts{parseUrl(url)};
  if (parts.scheme == "https") {
    auto* secureClient{new WiFiClientSecure()};
    secureClient->setInsecure();  // TODO: replace with cert pinning
    return WiFiClientHolder{secureClient, true};
  }

  return WiFiClientHolder{new WiFiClient(), false};
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

ota::OtaUpdater::ManifestResult getManifestResultForError(const String& err) {
  ota::OtaUpdater::ManifestResult res;
  res.ok = false;
  res.message = err;
  return res;
}

ota::OtaUpdater::UpdateResult getUpdateResultForError(const String& err) {
  ota::OtaUpdater::UpdateResult res;
  res.ok = false;
  res.updateApplied = false;
  res.message = err;
  return res;
}

String bytesToHexLower(const uint8_t* bytes, size_t len) {
  static const char* HEX_MAP{"0123456789abcdef"};
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; ++i) {
    out += HEX_MAP[(bytes[i] >> 4) & 0x0F];
    out += HEX_MAP[(bytes[i] >> 0) & 0x0F];
  }
  return out;
}

}  // namespace

namespace ota {

OtaUpdater::OtaUpdater(Config config)
    : config_(std::move(config)),
      signer_(config_.deviceId, config_.deviceSecret) {}

OtaUpdater::ManifestResult OtaUpdater::fetchLatestManifest() {
  if (WiFi.status() != WL_CONNECTED) {
    return getManifestResultForError("WiFi not connected");
  }

  // Create and parse manifest URL
  String manifestUrl{getManifestUrl()};
  UrlParts parts{parseUrl(manifestUrl)};
  if (parts.scheme.length() == 0 || parts.host.length() == 0) {
    return getManifestResultForError("Invalid manifest URL");
  }

  // Create HTTPClient
  auto wifiClientHolder{createWiFiClient(manifestUrl)};
  wifiClientHolder.client->setTimeout(config_.manifestTimeoutMs / 1000);
  HTTPClient httpClient;
  // Use an RAII guard to automatically end the HTTPClient when it goes out of
  // scope
  HTTPClientGuard httpClientGuard{httpClient};
  httpClient.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpClient.setTimeout(config_.manifestTimeoutMs);

  // Set up HTTP request for manifest
  if (!httpClient.begin(*wifiClientHolder.client, manifestUrl)) {
    return getManifestResultForError("HTTP begin failed (manifest)");
  }
  // Sign the request
  if (!signer_.writeAuthHeaders(httpClient)) {
    return getManifestResultForError("Failed to add auth headers (manifest)");
  }
  // Send the GET request
  const int code{httpClient.GET()};
  if (code <= 0) {
    return getManifestResultForError(String("HTTP GET failed (manifest): ") +
                                     httpClient.errorToString(code));
  } else if (code != 200) {
    return getManifestResultForError(String("HTTP GET status (manifest): ") +
                                     code);
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
  JsonDocument jsonDoc;
  DeserializationError jsonErr{deserializeJson(jsonDoc, stream)};
  if (jsonErr) {
    return getManifestResultForError(String("Manifest JSON parse error: ") +
                                     jsonErr.c_str());
  }

  if (jsonDoc["latest"].isNull()) {
    return getManifestResultForError("No published firmware in manifest");
  }

  ota::OtaUpdater::ManifestResult res;
  res.manifest.deviceType = jsonDoc["deviceType"] | "";
  res.manifest.channel = jsonDoc["channel"] | "";

  JsonObject latest{jsonDoc["latest"]};
  res.manifest.version = latest["version"] | "";
  res.manifest.buildNumber = latest["buildNumber"] | -1;
  res.manifest.sha256 = latest["sha256"] | "";
  res.manifest.size = (size_t)(latest["size"] | 0);

  res.ok = true;
  res.message = "Manifest fetched successfully";
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
    return getUpdateResultForError(manifestResult.message);
  }

  if (!isUpdateAvailable(manifestResult.manifest)) {
    OtaUpdater::UpdateResult updateResult;
    updateResult.ok = true;
    updateResult.updateApplied = false;
    updateResult.message = "Already up to date";
    updateResult.newBuildNumber = manifestResult.manifest.buildNumber;
    return updateResult;
  }

  return downloadAndUpdate(manifestResult.manifest, rebootOnSuccess);
}

String OtaUpdater::getManifestUrl() const {
  char urlBuf[256];
  snprintf(urlBuf, sizeof(urlBuf), config_.manifestEndpoint.c_str(),
           config_.deviceType.c_str(), config_.channel.c_str());
  return String(urlBuf);
}

String OtaUpdater::getFirmwareUrl(int buildNumber) const {
  char urlBuf[256];
  snprintf(urlBuf, sizeof(urlBuf), config_.firmwareEndpoint.c_str(),
           config_.deviceType.c_str(), config_.channel.c_str(), buildNumber);
  return String(urlBuf);
}

OtaUpdater::UpdateResult OtaUpdater::downloadAndUpdate(const Manifest& manifest,
                                                       bool rebootOnSuccess) {
  if (WiFi.status() != WL_CONNECTED) {
    return getUpdateResultForError("WiFi not connected");
  }

  if (manifest.buildNumber < 0) {
    return getUpdateResultForError("Manifest missing buildNumber");
  }

  // Create and parse firmware URL
  String url{getFirmwareUrl(manifest.buildNumber)};
  UrlParts parts{parseUrl(url)};
  if (parts.scheme.length() == 0 || parts.host.length() == 0) {
    return getUpdateResultForError("Invalid firmware URL");
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
  WiFiClientHolder wifiClientHolder{nullptr, false};
  for (int redirectCount = 0; redirectCount < 5; ++redirectCount) {
    // End any previous session before calling begin() again on same HTTPClient
    httpClient.end();

    // Create a separate WiFiClient for each hop as the redirect may switch
    // host/scheme
    wifiClientHolder = createWiFiClient(url);
    if (!wifiClientHolder.client) {
      return getUpdateResultForError("Failed to create WiFi client");
    }

    // Set up HTTP request for firmware
    if (!httpClient.begin(*wifiClientHolder.client, url)) {
      return getUpdateResultForError("HTTP begin failed (firmware)");
    }
    // Sign the request
    if (!signer_.writeAuthHeaders(httpClient)) {
      return getUpdateResultForError("Failed to add auth headers (firmware)");
    }
    // Send the GET request
    code = httpClient.GET();
    if (code <= 0) {
      return getUpdateResultForError(String("HTTP GET failed (firmware): ") +
                                     httpClient.errorToString(code));
    }

    if (!isRedirectCode(code)) {
      break;
    }

    // Go to next redirect hop
    String location{httpClient.header("Location")};
    if (location.length() == 0) {
      return getUpdateResultForError(
          String("HTTP redirect (firmware), code = ") + code +
          ", missing Location header");
    }
    url = location;
  }

  if (isRedirectCode(code)) {
    return getUpdateResultForError("Too many redirects when fetching firmware");
  } else if (code != 200) {
    String msg = String("HTTP status (firmware): ") + code;
    String body = httpClient.getString();
    if (body.length() > 0) {
      msg += " body: ";
      msg += body.substring(0, 200);
    }
    return getUpdateResultForError(msg);
  }

  // Validate content size
  int contentLen{httpClient.getSize()};
  if (manifest.size > 0 && contentLen > 0 &&
      (size_t)contentLen != manifest.size) {
    return getUpdateResultForError("Firmware size does not match manifest");
  }

  // Start OTA update
  if (!Update.begin(contentLen > 0 ? contentLen : UPDATE_SIZE_UNKNOWN)) {
    return getUpdateResultForError(String("Update.begin failed: ") +
                                   Update.errorString());
  }

  // Initialize SHA-256
  Sha256Guard sha;
  if (!sha.ok) {
    Update.abort();
    return getUpdateResultForError("SHA256 init failed");
  }

  // Stream body into Update, reading in chunks to avoid huge RAM use
  WiFiClient& stream{httpClient.getStream()};
  stream.setTimeout(
      config_.firmwareTimeoutMs);  // controls how long readBytes() blocks
  const size_t BUF_SZ{2048};
  uint8_t buf[BUF_SZ];
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
        return getUpdateResultForError("Firmware download stalled (no data)");
      }
      delay(1);
      continue;
    }

    size_t readBytes{
        stream.readBytes(buf, (size_t)min(availableBytes, (int)BUF_SZ))};
    if (readBytes == 0) {
      // Stream timeout
      if (millis() - lastProgressMs > STALL_TIMEOUT_MS) {
        Update.abort();
        return getUpdateResultForError("Firmware read timed out");
      }
      continue;
    }

    lastProgressMs = millis();

    // Update SHA
    if (!sha.update(buf, (size_t)readBytes)) {
      Update.abort();
      return getUpdateResultForError("SHA256 update failed");
    }

    // Write to OTA partition
    size_t writtenBytes{Update.write(buf, (size_t)readBytes)};
    if (writtenBytes != (size_t)readBytes) {
      Update.abort();
      return getUpdateResultForError(String("Update.write failed: ") +
                                     Update.errorString());
    }
    writtenTotal += writtenBytes;

    // If we know the content length, stop once we reach it
    if (contentLen > 0 && writtenTotal >= (size_t)contentLen) {
      break;
    }
  }

  // Verify written bytes against content length
  if (contentLen > 0 && writtenTotal != (size_t)contentLen) {
    Update.abort();
    return getUpdateResultForError("Firmware download ended early");
  }

  // Finish SHA and validate
  uint8_t digest[32];
  if (!sha.finish(digest)) {
    Update.abort();
    return getUpdateResultForError("SHA256 finish failed");
  }
  String gotSha{bytesToHexLower(digest, sizeof(digest))};
  String expectedSha{manifest.sha256};
  expectedSha.toLowerCase();
  if (gotSha != expectedSha) {
    Update.abort();
    return getUpdateResultForError("Firmware SHA256 mismatch");
  }

  // Finalize Update
  if (!Update.end(true)) {
    Update.abort();
    return getUpdateResultForError(String("Update.end failed: ") +
                                   Update.errorString());
  }
  if (!Update.isFinished()) {
    Update.abort();
    return getUpdateResultForError("Update not finished");
  }

  UpdateResult res;
  res.ok = true;
  res.updateApplied = true;
  res.message = "Update applied";
  res.newBuildNumber = manifest.buildNumber;

  if (rebootOnSuccess) {
    delay(200);
    ESP.restart();
  }

  return res;
}

}  // namespace ota