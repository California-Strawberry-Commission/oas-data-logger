#include "dlflib/components/uploader_component.h"

#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "dlflib/dlf_cfg.h"
#include "dlflib/dlf_logger.h"

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

std::unique_ptr<WiFiClient> connectToEndpoint(const String& url,
                                              int maxRetries = 3,
                                              uint32_t retryDelayMs = 500) {
  UrlParts parts{parseUrl(url)};
  if (parts.scheme.length() == 0 || parts.host.length() == 0) {
    Serial.println("[UploaderComponent][connectToEndpoint] Invalid URL");
    return nullptr;
  }

  bool useHttps{parts.scheme == "https"};

  WiFiClient* client = nullptr;
  if (useHttps) {
    auto* secureClient = new WiFiClientSecure();
    secureClient->setInsecure();
    client = secureClient;
  } else {
    client = new WiFiClient();
  }

  for (int attempt = 1; attempt <= maxRetries; ++attempt) {
    Serial.printf(
        "[UploaderComponent][connectToEndpoint] Attempt %d to %s:%u\n", attempt,
        parts.host.c_str(), parts.port);

    if (client->connect(parts.host.c_str(), parts.port)) {
      Serial.println(
          "[UploaderComponent][connectToEndpoint] Connected successfully");
      return std::unique_ptr<WiFiClient>(client);
    }

    Serial.println(
        "[UploaderComponent][connectToEndpoint] Connect failed, retrying...");
    delay(retryDelayMs);
  }

  Serial.println(
      "[UploaderComponent][connectToEndpoint] All connect retries failed");
  delete client;
  return nullptr;
}

}  // namespace

namespace dlf::components {

UploaderComponent::UploaderComponent(fs::FS& fs, const String& fsDir,
                                     const String& endpoint,
                                     const String& deviceUid,
                                     const Options& options)
    : fs_(fs),
      dir_(fsDir),
      endpoint_(endpoint),
      deviceUid_(deviceUid),
      options_(options) {}

bool UploaderComponent::begin() {
  Serial.println("[UploaderComponent] begin");
  wifiEvent_ = xEventGroupCreate();
  syncEvent_ = xEventGroupCreate();

  // Initial states
  if (WiFi.status() == WL_CONNECTED) {
    xEventGroupSetBits(wifiEvent_, WLAN_READY);
  } else {
    xEventGroupClearBits(wifiEvent_, WLAN_READY);
  }
  xEventGroupSetBits(syncEvent_, SYNC_COMPLETE);

  // State change callbacks
  WiFi.onEvent(std::bind(&UploaderComponent::onWifiDisconnected, this,
                         std::placeholders::_1, std::placeholders::_2),
               ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.onEvent(std::bind(&UploaderComponent::onWifiConnected, this,
                         std::placeholders::_1, std::placeholders::_2),
               ARDUINO_EVENT_WIFI_STA_GOT_IP);

  xTaskCreate(syncTask, "sync", 4096, this, 5, NULL);

  return true;
}

void UploaderComponent::onWifiDisconnected(arduino_event_id_t event,
                                           arduino_event_info_t info) {
  Serial.println("[UploaderComponent] WiFi disconnected");
  xEventGroupClearBits(wifiEvent_, WLAN_READY);
}

void UploaderComponent::onWifiConnected(arduino_event_id_t event,
                                        arduino_event_info_t info) {
  Serial.println("[UploaderComponent] WiFi connected");
  xEventGroupSetBits(wifiEvent_, WLAN_READY);
}

bool UploaderComponent::uploadRun(fs::File runDir, const String& runUuid,
                                  bool isActive) {
  if (!runDir) {
    Serial.println("[UploaderComponent] No file to upload");
    return false;
  }

  // List files to be uploaded
  Serial.println("[UploaderComponent] Files to upload:");
  runDir.rewindDirectory();
  fs::File tempFile;
  while (tempFile = runDir.openNextFile()) {
    Serial.printf("  - %s (%d bytes)\n", tempFile.name(), tempFile.size());
    tempFile.close();
  }

  char urlBuf[256];
  snprintf(urlBuf, sizeof(urlBuf), endpoint_.c_str(), runUuid.c_str());
  String uploadUrl = urlBuf;
  Serial.println("[UploaderComponent] Preparing to uploading to: " + uploadUrl);

  auto client = connectToEndpoint(uploadUrl);
  if (!client) {
    Serial.println("[UploaderComponent] Failed to connect to upload endpoint");
    return false;
  }

  ///////////////////////////
  // Multipart body templates
  ///////////////////////////
  // Note that we need to manually construct the multipart/form-data body, which
  // follows a very specific format.
  // Each file must be streamed (avoid fully loading into memory).
  // Fields MUST appear before files.
  const char* boundary = "dlfboundary";

  const char* fieldTemplate =
      "--dlfboundary\r\n"
      "Content-Disposition: form-data; name=\"%s\"\r\n\r\n"
      "%s\r\n";

  const char* fileTemplate =
      "--dlfboundary\r\n"
      "Content-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
      "Content-Type: application/octet-stream\r\n\r\n";

  const char* endBoundary = "--dlfboundary--\r\n";

  ///////////////////////////
  // Calculate content length
  ///////////////////////////
  size_t contentLength = 0;

  // Field: deviceUid
  contentLength +=
      snprintf(NULL, 0, fieldTemplate, "deviceUid", deviceUid_.c_str());

  // Field: isActive
  const char* isActiveStr = isActive ? "true" : "false";
  contentLength += snprintf(NULL, 0, fieldTemplate, "isActive", isActiveStr);

  // Files
  runDir.rewindDirectory();
  fs::File file = runDir.openNextFile();
  while (file) {
    contentLength += snprintf(NULL, 0, fileTemplate, file.name());
    contentLength += file.size();
    contentLength += 2;  // for trailing "\r\n" after file data
    file.close();
    file = runDir.openNextFile();
  }

  contentLength += strlen(endBoundary);

  //////////////////////
  // Send request header
  //////////////////////
  Serial.println("[UploaderComponent] Sending upload request...");

  UrlParts parts = parseUrl(uploadUrl);

  client->printf("POST %s HTTP/1.1\r\n", parts.path.c_str());
  client->printf("Host: %s\r\n", parts.host.c_str());
  client->printf("Content-Type: multipart/form-data; boundary=%s\r\n",
                 boundary);
  client->printf("Content-Length: %zu\r\n", contentLength);
  client->println("Connection: close\r\n");
  client->println();  // end of headers

  ////////////////////////
  // Send multipart fields
  ////////////////////////
  client->printf(fieldTemplate, "deviceUid", deviceUid_.c_str());
  client->printf(fieldTemplate, "isActive", isActiveStr);

  //////////////////
  // Send file parts
  //////////////////
  runDir.rewindDirectory();
  uint8_t buf[128];
  const size_t chunkSize = sizeof(buf);

  file = runDir.openNextFile();
  while (file) {
    // Send file boundary
    client->printf(fileTemplate, file.name());

    // Send file data
    while (file.available()) {
      size_t len = file.read(buf, chunkSize);
      client->write(buf, len);
    }

    client->print("\r\n");
    file.close();
    file = runDir.openNextFile();
  }

  ////////////////////
  // Send end boundary
  ////////////////////
  client->print(endBoundary);

  ////////////////////
  // Wait for response
  ////////////////////
  unsigned long startMillis = millis();
  while (client->connected() && millis() - startMillis < 5000) {
    if (client->available()) {
      // We don't need to process the full response body, so return as soon as
      // we receive a line
      String statusLine = client->readStringUntil('\n');
      Serial.println("[UploaderComponent] Response: " + statusLine);
      client->stop();

      return statusLine.startsWith("HTTP/1.1 200") ||
             statusLine.startsWith("HTTP/1.0 200");
    }
  }

  Serial.println("[UploaderComponent] No response received within 5 seconds");
  client->stop();
  return false;
}

void UploaderComponent::waitForSyncCompletion() {
  xEventGroupWaitBits(syncEvent_, SYNC_COMPLETE, pdFALSE, pdTRUE,
                      portMAX_DELAY);
}

void UploaderComponent::syncTask(void* arg) {
  UploaderComponent* uploaderComponent = static_cast<UploaderComponent*>(arg);
  CSCLogger* logger = uploaderComponent->getComponent<CSCLogger>();

  if (!logger) {
    Serial.println(
        "[UploaderComponent][syncTask] NO LOGGER. This should not happen");
    vTaskDelete(NULL);
  }

  while (true) {
    // Make sure SD is inserted and provided path is a dir
    fs::File root = uploaderComponent->fs_.open(uploaderComponent->dir_);
    if (!root) {
      Serial.println("[UploaderComponent][syncTask] No storage found");
      vTaskDelay(pdMS_TO_TICKS(1000));
      vTaskDelete(NULL);
    }

    if (!root.isDirectory()) {
      Serial.println(
          "[UploaderComponent][syncTask] Root is not dir - exiting sync");
      vTaskDelete(NULL);
    }

    // Wait for wifi to be connected
    xEventGroupWaitBits(uploaderComponent->wifiEvent_, WLAN_READY, pdFALSE,
                        pdTRUE, portMAX_DELAY);

    Serial.println("[UploaderComponent][syncTask] WLAN ready - beginning sync");

    xEventGroupClearBits(uploaderComponent->syncEvent_, SYNC_COMPLETE);

    fs::File runDir;
    int numFailures = 0;
    while (xEventGroupGetBits(uploaderComponent->wifiEvent_) & WLAN_READY &&
           (runDir = root.openNextFile()) && numFailures < 3) {
      // Skip syncing files, hidden dirs, and system volume information dir
      if (!runDir.isDirectory() || runDir.name()[0] == '.' ||
          !strcmp(runDir.name(), "System Volume Information")) {
        continue;
      }

      String runDirPath = resolvePath({uploaderComponent->dir_, runDir.name()});

      // Skip syncing in-progress runs. We check the presence of the
      // lock file, which indicates that the run is incomplete.
      bool lockfileFound = false;
      // Skip syncing runs that have already been uploaded. We check for the
      // presence of a file with a specific filename, which indicates that the
      // run has already been uploaded.
      bool uploadMarkerFound = false;
      fs::File file;
      while (file = runDir.openNextFile()) {
        if (!strcmp(file.name(), LOCKFILE_NAME)) {
          lockfileFound = true;
          break;
        } else if (!strcmp(file.name(), UPLOAD_MARKER_FILE_NAME)) {
          uploadMarkerFound = true;
          break;
        }
      }
      if (lockfileFound) {
        Serial.printf(
            "[UploaderComponent][syncTask] %s is active and/or incomplete. "
            "Skipping\n",
            runDirPath.c_str());
        continue;
      } else if (uploadMarkerFound) {
        Serial.printf(
            "[UploaderComponent][syncTask] %s has already been uploaded. "
            "Skipping\n",
            runDirPath.c_str());
        continue;
      }

      // Upload run
      Serial.printf("[UploaderComponent][syncTask] Syncing: %s\n",
                    runDir.name());

      runDir.rewindDirectory();

      bool uploadSuccess = uploaderComponent->uploadRun(runDir, runDir.name());
      numFailures += !uploadSuccess;

      if (uploadSuccess) {
        Serial.println("[UploaderComponent][syncTask] Upload successful");
        if (uploaderComponent->options_.deleteAfterUpload) {
          // Remove run data
          runDir.rewindDirectory();
          while (file = runDir.openNextFile()) {
            uploaderComponent->fs_.remove(
                resolvePath({runDirPath, file.name()}));
          }
          uploaderComponent->fs_.rmdir(runDirPath);
          Serial.printf(
              "[UploaderComponent][syncTask] Removed run data for %s\n",
              runDir.name());
        } else if (uploaderComponent->options_.markAfterUpload) {
          // Add upload marker
          String markerFilePath =
              resolvePath({runDirPath, UPLOAD_MARKER_FILE_NAME});
          fs::File f = uploaderComponent->fs_.open(markerFilePath, "w", true);
          f.write(0);
          f.close();
          Serial.printf("[UploaderComponent][syncTask] Marked %s as uploaded\n",
                        runDir.name());
        }
      } else {
        Serial.println("[UploaderComponent][syncTask] Upload failed");
      }
    }

    root.close();
    Serial.printf("[UploaderComponent][syncTask] Done syncing (failures: %d)\n",
                  numFailures);

    xEventGroupSetBits(uploaderComponent->syncEvent_, SYNC_COMPLETE);

    xEventGroupWaitBits(logger->ev, CSCLogger::NEW_RUN, pdTRUE, pdTRUE,
                        portMAX_DELAY);
  }
}

}  // namespace dlf::components