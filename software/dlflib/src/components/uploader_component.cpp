#include "dlflib/components/uploader_component.h"

#include "dlflib/dlf_cfg.h"
#include "dlflib/dlf_logger.h"
#include "dlflib/log.h"

namespace dlf::components {

UploaderComponent::UploaderComponent(fs::FS& fs, const char* fsDir,
                                     const char* endpointFmt,
                                     const char* deviceUid, const char* secret,
                                     const Options& options)
    : fs_(fs), options_(options), signer_(deviceUid, secret) {
  snprintf(dir_, sizeof(dir_), "%s", fsDir ? fsDir : "");
  snprintf(endpointFmt_, sizeof(endpointFmt_), "%s",
           endpointFmt ? endpointFmt : "");
}

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

bool UploaderComponent::uploadRun(fs::File runDir, const char* runUuid,
                                  bool isActive) {
  if (!runDir) {
    DLFLIB_LOG_INFO("[UploaderComponent] No file to upload");
    return false;
  }

  // List files to be uploaded
  DLFLIB_LOG_INFO("[UploaderComponent] Files to upload:");
  runDir.rewindDirectory();
  while (true) {
    fs::File file = runDir.openNextFile();
    if (!file) {
      break;
    }

    DLFLIB_LOG_INFO("  - %s (%d bytes)", file.name(), file.size());
    file.close();
  }

  char uploadUrl[256];
  snprintf(uploadUrl, sizeof(uploadUrl), endpointFmt_, runUuid ? runUuid : "");
  DLFLIB_LOG_INFO("[UploaderComponent] Preparing to uploading to: %s",
                  uploadUrl);

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

  // Field: isActive
  const char* isActiveStr = isActive ? "true" : "false";
  contentLength += snprintf(NULL, 0, fieldTemplate, "isActive", isActiveStr);

  // Files
  runDir.rewindDirectory();

  while (true) {
    fs::File file = runDir.openNextFile();
    if (!file) {
      break;
    }

    contentLength += snprintf(NULL, 0, fileTemplate, file.name());
    contentLength += file.size();
    contentLength += 2;  // for trailing "\r\n" after file data
    file.close();
  }

  contentLength += strlen(endBoundary);

  //////////////////////
  // Send request header
  //////////////////////
  DLFLIB_LOG_INFO("[UploaderComponent] Sending upload request...");

  dlf::util::UrlParts parts = dlf::util::parseUrl(uploadUrl);
  if (!parts.ok) {
    DLFLIB_LOG_ERROR("[UploaderComponent] Invalid upload URL");
    client->stop();
    return false;
  }

  client->printf("POST %s HTTP/1.1\r\n", parts.path);
  client->printf("Host: %s\r\n", parts.host);

  signer_.writeAuthHeaders(*client, runUuid);

  client->printf("Content-Type: multipart/form-data; boundary=%s\r\n",
                 boundary);
  client->printf("Content-Length: %zu\r\n", contentLength);
  client->print("Connection: close\r\n");
  client->print("\r\n");  // end of headers

  ////////////////////////
  // Send multipart fields
  ////////////////////////
  client->printf(fieldTemplate, "isActive", isActiveStr);

  //////////////////
  // Send file parts
  //////////////////
  runDir.rewindDirectory();
  uint8_t buf[128];
  const size_t chunkSize = sizeof(buf);

  while (true) {
    fs::File file = runDir.openNextFile();
    if (!file) {
      break;
    }

    // Send file boundary
    client->printf(fileTemplate, file.name());

    // Send file data
    while (file.available()) {
      size_t len = file.read(buf, chunkSize);
      client->write(buf, len);
    }

    client->print("\r\n");
    file.close();
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
      char status[64] = {0};
      size_t n = client->readBytesUntil('\n', status, sizeof(status) - 1);
      status[n] = '\0';
      bool ok = (strncmp(status, "HTTP/1.1 200", 12) == 0) ||
                (strncmp(status, "HTTP/1.0 200", 12) == 0);
      return ok;
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
      root.close();
      vTaskDelete(NULL);
    }

    // Wait for wifi to be connected
    xEventGroupWaitBits(uploaderComponent->wifiEvent_, WLAN_READY, pdFALSE,
                        pdTRUE, portMAX_DELAY);

    DLFLIB_LOG_INFO("[UploaderComponent][syncTask] WLAN ready");

    xEventGroupClearBits(uploaderComponent->syncEvent_, SYNC_COMPLETE);

    int numFailures = 0;
    while (xEventGroupGetBits(uploaderComponent->wifiEvent_) & WLAN_READY &&
           numFailures < 3) {
      fs::File runDir = root.openNextFile();
      if (!runDir) {
        break;
      }

      // Skip syncing files, hidden dirs, and system volume information dir
      if (!runDir.isDirectory() || runDir.name()[0] == '.' ||
          !strcmp(runDir.name(), "System Volume Information")) {
        runDir.close();
        continue;
      }

      char runDirPath[256];
      dlf::util::joinPath(runDirPath, sizeof(runDirPath),
                          uploaderComponent->dir_, runDir.name());

      // Detect lockfile (indicates an active run) and upload marker file
      // (indicates that the run has already been uploaded)
      bool lockfileFound = false;
      bool uploadMarkerFound = false;

      while (true) {
        fs::File file = runDir.openNextFile();
        if (!file) {
          break;
        }

        const bool isLockfile = !strcmp(file.name(), LOCKFILE_NAME);
        const bool isUploadMarker =
            !strcmp(file.name(), UPLOAD_MARKER_FILE_NAME);
        file.close();

        if (isLockfile) {
          lockfileFound = true;
          break;
        }
        if (isUploadMarker) {
          uploadMarkerFound = true;
          break;
        }
      }

      // Skip uploading active run
      if (lockfileFound) {
        DLFLIB_LOG_INFO(
            "[UploaderComponent][syncTask] %s is active and/or incomplete. "
            "Skipping",
            runDirPath);
        runDir.close();
        continue;
      }

      // Skip already uploaded run
      if (uploadMarkerFound) {
        DLFLIB_LOG_INFO(
            "[UploaderComponent][syncTask] %s has already been uploaded. "
            "Skipping",
            runDirPath);
        runDir.close();
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

          char path[256];
          while (true) {
            fs::File file = runDir.openNextFile();
            if (!file) {
              break;
            }

            dlf::util::joinPath(path, sizeof(path), runDirPath, file.name());
            file.close();
            uploaderComponent->fs_.remove(path);
          }

          uploaderComponent->fs_.rmdir(runDirPath);
          DLFLIB_LOG_INFO(
              "[UploaderComponent][syncTask] Removed run data for %s",
              runDir.name());
        } else if (uploaderComponent->options_.markAfterUpload) {
          // Add upload marker to indicate that this run has been uploaded
          char markerFilePath[256];
          dlf::util::joinPath(markerFilePath, sizeof(markerFilePath),
                              runDirPath, UPLOAD_MARKER_FILE_NAME);
          fs::File file =
              uploaderComponent->fs_.open(markerFilePath, "w", true);
          if (file) {
            file.write(0);
            file.close();
          }
          DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Marked %s as uploaded",
                          runDir.name());
        }
      } else {
        DLFLIB_LOG_ERROR("[UploaderComponent][syncTask] Upload failed");
      }

      runDir.close();
    }

    root.close();
    DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Done syncing (failures: %d)",
                    numFailures);

    xEventGroupSetBits(uploaderComponent->syncEvent_, SYNC_COMPLETE);

    logger->waitForRunComplete();
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

      char runDirPath[256];
      dlf::util::joinPath(runDirPath, sizeof(runDirPath),
                          uploaderComponent->dir_, run->uuid());
      fs::File runDir = uploaderComponent->fs_.open(runDirPath);
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

      runDir.close();
    }

    // Block until desired interval has passed since the last loop
    vTaskDelayUntil(&lastWakeTime, period);
  }
}

WiFiClient* UploaderComponent::getWiFiClient(bool secure) {
  if (secure) {
    if (!wifiClientSecure_) {
      wifiClientSecure_ = dlf::util::make_unique<WiFiClientSecure>();
      wifiClientSecure_->setInsecure();
    }
    return wifiClientSecure_.get();
  } else {
    if (!wifiClient_) {
      wifiClient_ = dlf::util::make_unique<WiFiClient>();
    }
    return wifiClient_.get();
  }
}

WiFiClient* UploaderComponent::connectToEndpoint(const char* url,
                                                 int maxRetries,
                                                 uint32_t retryDelayMs) {
  dlf::util::UrlParts parts = dlf::util::parseUrl(url);
  if (!parts.ok) {
    DLFLIB_LOG_ERROR("[UploaderComponent][connectToEndpoint] Invalid URL");
    return nullptr;
  }

  const bool useHttps = (strcmp(parts.scheme, "https") == 0);
  WiFiClient* client = getWiFiClient(useHttps);
  if (!client) {
    return nullptr;
  }

  // Ensure clean state on WiFiClient
  client->stop();

  for (int attempt = 1; attempt <= maxRetries; ++attempt) {
    DLFLIB_LOG_INFO(
        "[UploaderComponent][connectToEndpoint] Attempt %d to %s:%u", attempt,
        parts.host, parts.port);

    if (client->connect(parts.host, parts.port)) {
      DLFLIB_LOG_INFO(
          "[UploaderComponent][connectToEndpoint] Connected successfully");
      return client;
    }

    DLFLIB_LOG_WARNING(
        "[UploaderComponent][connectToEndpoint] Connect failed, retrying...");
    delay(retryDelayMs);
  }

  DLFLIB_LOG_ERROR(
      "[UploaderComponent][connectToEndpoint] All connect retries failed");
  client->stop();
  return nullptr;
}

}  // namespace dlf::components