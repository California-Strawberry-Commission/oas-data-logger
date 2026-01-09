#include "ota_updater/ota_updater.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

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

}  // namespace

namespace ota {

OtaUpdater::OtaUpdater(Config config) : config_(std::move(config)) {}

bool OtaUpdater::fetchLatest(Manifest& out, String& err) {
  out = Manifest{};
  err = "";

  if (WiFi.status() != WL_CONNECTED) {
    err = "WiFi not connected";
    return false;
  }

  // Create and parse manifest URL
  String manifestUrl{getManifestUrl()};
  UrlParts parts{parseUrl(manifestUrl)};
  if (parts.scheme.length() == 0 || parts.host.length() == 0) {
    err = "[OtaUpdater] Invalid manifest URL";
    return false;
  }

  // Create WiFiClient
  bool useHttps{parts.scheme == "https"};
  WiFiClient* client = nullptr;
  if (useHttps) {
    auto* secureClient = new WiFiClientSecure();
    secureClient->setInsecure();
    client = secureClient;
  } else {
    client = new WiFiClient();
  }

  HTTPClient http;
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(config_.httpTimeoutMs);

  // Make GET request
  if (!http.begin(*client, manifestUrl)) {
    err = "HTTP begin failed (manifest)";
    return false;
  }
  const int code = http.GET();
  if (code <= 0) {
    err = String("HTTP GET failed (manifest): ") + http.errorToString(code);
    http.end();
    return false;
  }
  if (code != 200) {
    err = String("HTTP GET status (manifest): ") + code;
    http.end();
    return false;
  }

  // Parse JSON from stream
  JsonDocument jsonDoc;
  DeserializationError jerr = deserializeJson(jsonDoc, http.getString());
  http.end();
  if (jerr) {
    err = String("Manifest JSON parse error: ") + jerr.c_str();
    return false;
  }

  out.deviceType = jsonDoc["deviceType"] | "";
  out.channel = jsonDoc["channel"] | "";

  if (jsonDoc["latest"].isNull()) {
    out.hasLatest = false;
    return true;
  }

  JsonObject latest = jsonDoc["latest"];
  out.hasLatest = true;
  out.version = latest["version"] | "";
  out.buildNumber = latest["buildNumber"] | -1;
  out.sha256 = latest["sha256"] | "";
  out.size = (size_t)(latest["size"] | 0);

  return true;
}

bool OtaUpdater::isUpdateAvailable(const Manifest& manifest) const {
  // TODO
  return false;
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

}  // namespace ota