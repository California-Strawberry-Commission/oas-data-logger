#include "dlflib/components/uploader_component.h"

#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "dlflib/dlf_cfg.h"
#include "dlflib/dlf_logger.h"
#include "dlflib/log.h"

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
    DLFLIB_LOG_ERROR("[UploaderComponent][connectToEndpoint] Invalid URL");
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
    DLFLIB_LOG_INFO(
        "[UploaderComponent][connectToEndpoint] Attempt %d to %s:%u", attempt,
        parts.host.c_str(), parts.port);

    if (client->connect(parts.host.c_str(), parts.port)) {
      DLFLIB_LOG_INFO(
          "[UploaderComponent][connectToEndpoint] Connected successfully");
      return std::unique_ptr<WiFiClient>(client);
    }

    DLFLIB_LOG_WARNING(
        "[UploaderComponent][connectToEndpoint] Connect failed, retrying...");
    delay(retryDelayMs);
  }

  DLFLIB_LOG_ERROR(
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
  DLFLIB_LOG_INFO("[UploaderComponent] begin");
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

  xTaskCreate(syncTask, "sync", 8192, this, 5, NULL);

  if (options_.partialRunUploadIntervalSecs > 0) {
    xTaskCreate(partialRunUploadTask, "partial_run_upload", 8192, this, 5,
                NULL);
  }

  return true;
}

void UploaderComponent::onWifiDisconnected(arduino_event_id_t event,
                                           arduino_event_info_t info) {
  DLFLIB_LOG_INFO("[UploaderComponent] WiFi disconnected");
  xEventGroupClearBits(wifiEvent_, WLAN_READY);
}

void UploaderComponent::onWifiConnected(arduino_event_id_t event,
                                        arduino_event_info_t info) {
  DLFLIB_LOG_INFO("[UploaderComponent] WiFi connected");
  xEventGroupSetBits(wifiEvent_, WLAN_READY);
}

bool UploaderComponent::uploadRun(fs::File runDir, const String& runUuid,
                                  bool isActive) {
  if (!runDir) {
    DLFLIB_LOG_INFO("[UploaderComponent] No file to upload");
    return false;
  }

  // List files to be uploaded
  DLFLIB_LOG_INFO("[UploaderComponent] Files to upload:");
  runDir.rewindDirectory();
  fs::File tempFile;
  while (tempFile = runDir.openNextFile()) {
    DLFLIB_LOG_INFO("  - %s (%d bytes)", tempFile.name(), tempFile.size());
    tempFile.close();
  }

  char urlBuf[256];
  snprintf(urlBuf, sizeof(urlBuf), endpoint_.c_str(), runUuid.c_str());
  String uploadUrl = urlBuf;
  DLFLIB_LOG_INFO("[UploaderComponent] Preparing to uploading to: %s",
                  uploadUrl.c_str());

  auto client = connectToEndpoint(uploadUrl);
  if (!client) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent] Failed to connect to upload endpoint");
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
  DLFLIB_LOG_INFO("[UploaderComponent] Sending upload request...");

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
      DLFLIB_LOG_INFO("[UploaderComponent] Response: %s", statusLine.c_str());
      client->stop();

      return statusLine.startsWith("HTTP/1.1 200") ||
             statusLine.startsWith("HTTP/1.0 200");
    }
  }

  DLFLIB_LOG_ERROR("[UploaderComponent] No response received within 5 seconds");
  client->stop();
  return false;
}

void UploaderComponent::waitForSyncCompletion() {
  xEventGroupWaitBits(syncEvent_, SYNC_COMPLETE, pdFALSE, pdTRUE,
                      portMAX_DELAY);
}

/**
 * This task scans the SD card to find completed runs that have not yet been
 * uploaded, and uploads their data.
 */
void UploaderComponent::syncTask(void* arg) {
  UploaderComponent* uploaderComponent = static_cast<UploaderComponent*>(arg);
  DLFLogger* logger = uploaderComponent->getComponent<DLFLogger>();

  if (!logger) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][syncTask] NO LOGGER. This should not happen. "
        "Terminating task");
    vTaskDelete(NULL);
  }

  while (true) {
    // Make sure SD is inserted and provided path is a dir
    fs::File root = uploaderComponent->fs_.open(uploaderComponent->dir_);
    if (!root) {
      DLFLIB_LOG_ERROR(
          "[UploaderComponent][syncTask] No storage found. Terminating task");
      vTaskDelay(pdMS_TO_TICKS(1000));
      vTaskDelete(NULL);
    }

    if (!root.isDirectory()) {
      DLFLIB_LOG_ERROR(
          "[UploaderComponent][syncTask] Root is not dir. Terminating task");
      vTaskDelete(NULL);
    }

    // Wait for wifi to be connected
    xEventGroupWaitBits(uploaderComponent->wifiEvent_, WLAN_READY, pdFALSE,
                        pdTRUE, portMAX_DELAY);

    DLFLIB_LOG_INFO("[UploaderComponent][syncTask] WLAN ready");

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

      String runDirPath =
          dlf::util::resolvePath({uploaderComponent->dir_, runDir.name()});

      // Detect lockfile (indicates an active run) and upload marker file
      // (indicates that the run has already been uploaded)
      bool lockfileFound = false;
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

      // Skip uploading active run
      if (lockfileFound) {
        DLFLIB_LOG_INFO(
            "[UploaderComponent][syncTask] %s is active and/or incomplete. "
            "Skipping",
            runDirPath.c_str());
        continue;
      }

      // Skip already uploaded run
      if (uploadMarkerFound) {
        DLFLIB_LOG_INFO(
            "[UploaderComponent][syncTask] %s has already been uploaded. "
            "Skipping",
            runDirPath.c_str());
        continue;
      }

      // Upload completed run that has not been uploaded yet
      DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Uploading: %s",
                      runDir.name());

      runDir.rewindDirectory();

      bool uploadSuccess = uploaderComponent->uploadRun(runDir, runDir.name());
      numFailures += !uploadSuccess;

      if (uploadSuccess) {
        DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Upload successful");
        if (uploaderComponent->options_.deleteAfterUpload) {
          // Remove run data
          runDir.rewindDirectory();
          while (file = runDir.openNextFile()) {
            uploaderComponent->fs_.remove(
                dlf::util::resolvePath({runDirPath, file.name()}));
          }
          uploaderComponent->fs_.rmdir(runDirPath);
          DLFLIB_LOG_INFO(
              "[UploaderComponent][syncTask] Removed run data for %s",
              runDir.name());
        } else if (uploaderComponent->options_.markAfterUpload) {
          // Add upload marker to indicate that this run has been uploaded
          String markerFilePath =
              dlf::util::resolvePath({runDirPath, UPLOAD_MARKER_FILE_NAME});
          fs::File f = uploaderComponent->fs_.open(markerFilePath, "w", true);
          f.write(0);
          f.close();
          DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Marked %s as uploaded",
                          runDir.name());
        }
      } else {
        DLFLIB_LOG_ERROR("[UploaderComponent][syncTask] Upload failed");
      }
    }

    root.close();
    DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Done syncing (failures: %d)",
                    numFailures);

    xEventGroupSetBits(uploaderComponent->syncEvent_, SYNC_COMPLETE);

    logger->waitForNewRun();
  }
}

/**
 * This task attempts to upload data for currently active runs at a regular
 * interval.
 */
void UploaderComponent::partialRunUploadTask(void* arg) {
  UploaderComponent* uploaderComponent = static_cast<UploaderComponent*>(arg);
  DLFLogger* logger = uploaderComponent->getComponent<DLFLogger>();

  if (!logger) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][partialRunUploadTask] NO LOGGER. This should not "
        "happen. Terminating task");
    vTaskDelete(NULL);
  }

  int intervalSecs = uploaderComponent->options_.partialRunUploadIntervalSecs;
  if (intervalSecs <= 0) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][partialRunUploadTask] Invalid interval. "
        "Terminating task");
    vTaskDelete(NULL);
  }
  const TickType_t period = pdMS_TO_TICKS(intervalSecs * 1000);
  TickType_t lastWakeTime = xTaskGetTickCount();

  DLFLIB_LOG_INFO(
      "[UploaderComponent][partialRunUploadTask] Partial upload interval: %d",
      intervalSecs);
  while (true) {
    // Wait for wifi to be connected
    xEventGroupWaitBits(uploaderComponent->wifiEvent_, WLAN_READY, pdFALSE,
                        pdTRUE, portMAX_DELAY);
    DLFLIB_LOG_INFO("[UploaderComponent][partialRunUploadTask] WLAN ready");

    // Start partial run upload
    for (run_handle_t h : logger->getActiveRuns()) {
      Run* run = logger->getRun(h);
      if (!run) {
        DLFLIB_LOG_WARNING(
            "[UploaderComponent][partialRunUploadTask] Invalid run handle. "
            "Skipping");
        continue;
      }

      DLFLIB_LOG_INFO(
          "[UploaderComponent][partialRunUploadTask] Attempting upload for "
          "active run %s",
          run->uuid());

      // Manually flush the log files for the run. This updates the log file
      // headers.
      run->flushLogFiles();

      // Acquire locks on run's LogFiles to avoid conflict with SD card writes
      // when uploading.
      RunLogFilesLock lock(run);

      fs::File runDir = uploaderComponent->fs_.open(uploaderComponent->dir_ +
                                                    "/" + run->uuid());
      if (!runDir || !runDir.isDirectory()) {
        DLFLIB_LOG_WARNING(
            "[UploaderComponent][partialRunUploadTask] Invalid run dir %s. "
            "Skipping.",
            runDir.name());
        continue;
      }

      bool uploadSuccess =
          uploaderComponent->uploadRun(runDir, runDir.name(), true);
      if (uploadSuccess) {
        DLFLIB_LOG_INFO(
            "[UploaderComponent][partialRunUploadTask] Upload successful");
      } else {
        DLFLIB_LOG_ERROR(
            "[UploaderComponent][partialRunUploadTask] Upload failed");
      }
    }

    // Block until desired interval has passed since the last loop
    vTaskDelayUntil(&lastWakeTime, period);
  }
}

}  // namespace dlf::components