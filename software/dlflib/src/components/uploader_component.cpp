#include "dlflib/components/uploader_component.h"

#include "dlflib/dlf_cfg.h"
#include "dlflib/dlf_logger.h"
#include "dlflib/log.h"

namespace {

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

}  // namespace

namespace dlf::components {

UploaderComponent::UploaderComponent(fs::FS& fs, const char* fsDir,
                                     const char* endpointFmt,
                                     const char* deviceUid,
                                     const Options& options)
    : fs_(fs), options_(options), signer_(deviceUid, options.secret) {
  snprintf(fsDir_, sizeof(fsDir_), "%s", fsDir ? fsDir : "");
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
    DLFLIB_LOG_ERROR("[UploaderComponent][uploadRun] No file to upload");
    return false;
  }

  if (!runUuid) {
    DLFLIB_LOG_ERROR("[UploaderComponent][uploadRun] Invalid run UUID");
    return false;
  }

  // List files to be uploaded
  DLFLIB_LOG_INFO("[UploaderComponent][uploadRun] Files to upload:");
  runDir.rewindDirectory();
  while (fs::File file = runDir.openNextFile()) {
    DLFLIB_LOG_INFO("  - %s (%d bytes)", file.name(), file.size());
    file.close();
  }

  char uploadUrl[256];
  snprintf(uploadUrl, sizeof(uploadUrl), endpointFmt_, runUuid ? runUuid : "");
  DLFLIB_LOG_INFO(
      "[UploaderComponent][uploadRun] Preparing to uploading to: %s",
      uploadUrl);

  auto client = connectToEndpoint(uploadUrl);
  if (!client) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][uploadRun] Failed to connect to upload endpoint");
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

  while (fs::File file = runDir.openNextFile()) {
    contentLength += snprintf(NULL, 0, fileTemplate, file.name());
    contentLength += file.size();
    contentLength += 2;  // for trailing "\r\n" after file data
    file.close();
  }

  contentLength += strlen(endBoundary);

  //////////////////////
  // Send request header
  //////////////////////
  DLFLIB_LOG_INFO("[UploaderComponent][uploadRun] Sending upload request...");

  dlf::util::UrlParts parts = dlf::util::parseUrl(uploadUrl);
  if (!parts.ok) {
    DLFLIB_LOG_ERROR("[UploaderComponent][uploadRun] Invalid upload URL");
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

  while (fs::File file = runDir.openNextFile()) {
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
      int code = 0;
      sscanf(status, "HTTP/%*s %d", &code);
      bool ok = (code >= 200 && code < 300);
      return ok;
    }
  }

  DLFLIB_LOG_ERROR(
      "[UploaderComponent][uploadRun] No response received within 5 seconds");
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
    fs::File root = uploaderComponent->fs_.open(uploaderComponent->fsDir_);
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

      char runDirPath[128];
      dlf::util::joinPath(runDirPath, sizeof(runDirPath),
                          uploaderComponent->fsDir_, runDir.name());

      // Detect lockfile (indicates an active run) and upload marker file
      // (indicates that the run has already been uploaded)
      bool lockfileFound = false;
      bool uploadMarkerFound = false;

      while (fs::File file = runDir.openNextFile()) {
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

      // Skip (or delete) already uploaded run
      if (uploadMarkerFound) {
        if (uploaderComponent->options_.retentionMode ==
            RetentionMode::DELETE) {
          DLFLIB_LOG_INFO(
              "[UploaderComponent][syncTask] %s has already been uploaded. "
              "RetentionMode is DELETE. Deleting run data.",
              runDirPath);
          uploaderComponent->deleteRunDir(runDir, runDirPath);
          continue;
        } else {
          DLFLIB_LOG_INFO(
              "[UploaderComponent][syncTask] %s has already been uploaded. "
              "Skipping.",
              runDirPath);
          runDir.close();
          continue;
        }
      }

      // Upload completed run that has not been uploaded yet
      DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Uploading: %s",
                      runDir.name());

      runDir.rewindDirectory();

      bool uploadSuccess =
          uploaderComponent->options_.enableChunkedUpload
              ? uploaderComponent->uploadRunChunked(runDir, runDir.name())
              : uploaderComponent->uploadRun(runDir, runDir.name());
      if (!uploadSuccess) {
        DLFLIB_LOG_ERROR("[UploaderComponent][syncTask] Upload failed");
        runDir.close();
        ++numFailures;
        continue;
      }

      DLFLIB_LOG_INFO("[UploaderComponent][syncTask] Upload successful");
      switch (uploaderComponent->options_.retentionMode) {
        case RetentionMode::DELETE: {
          DLFLIB_LOG_INFO(
              "[UploaderComponent][syncTask] RetentionMode is DELETE. Deleting "
              "run data for %s",
              runDir.name());
          uploaderComponent->deleteRunDir(runDir, runDirPath);
          break;
        }

        case RetentionMode::MARK: {
          // Add upload marker to indicate that this run has been uploaded
          char markerFilePath[128];
          dlf::util::joinPath(markerFilePath, sizeof(markerFilePath),
                              runDirPath, UPLOAD_MARKER_FILE_NAME);
          fs::File file =
              uploaderComponent->fs_.open(markerFilePath, "w", true);
          if (file) {
            file.write(0);
            file.close();
          }
          DLFLIB_LOG_INFO(
              "[UploaderComponent][syncTask] RetentionMode is MARK. Marked %s "
              "as uploaded",
              runDir.name());
          runDir.close();
          break;
        }

        case RetentionMode::KEEP:
        default:
          runDir.close();
          break;
      }
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

      char runDirPath[128];
      dlf::util::joinPath(runDirPath, sizeof(runDirPath),
                          uploaderComponent->fsDir_, run->uuid());
      fs::File runDir = uploaderComponent->fs_.open(runDirPath);
      if (!runDir || !runDir.isDirectory()) {
        DLFLIB_LOG_WARNING(
            "[UploaderComponent][partialRunUploadTask] Invalid run dir %s. "
            "Skipping.",
            runDir.name());
        continue;
      }

      bool uploadSuccess =
          uploaderComponent->options_.enableChunkedUpload
              ? uploaderComponent->uploadRunChunked(runDir, runDir.name(),
                                                    /*isActive=*/true)
              : uploaderComponent->uploadRun(runDir, runDir.name(),
                                             /*isActive=*/true);
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
      if (options_.caCert != nullptr) {
        wifiClientSecure_->setCACert(options_.caCert);
      } else {
        wifiClientSecure_->setInsecure();
      }
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

bool UploaderComponent::deleteRunDir(fs::File runDir, const char* runDirPath) {
  if (!runDir || !runDir.isDirectory() || !runDirPath) {
    return false;
  }

  runDir.rewindDirectory();

  char path[128];
  while (fs::File file = runDir.openNextFile()) {
    dlf::util::joinPath(path, sizeof(path), runDirPath, file.name());
    file.close();

    if (!fs_.remove(path)) {
      // Continue best-effort deletion, but log failure
      DLFLIB_LOG_WARNING("[UploaderComponent] Failed to remove %s", path);
    }
  }

  const bool ok = fs_.rmdir(runDirPath);
  runDir.close();
  return ok;
}

bool UploaderComponent::uploadRunChunked(fs::File runDir, const char* runUuid,
                                         bool isActive, bool finalize,
                                         size_t maxChunkSize) {
  if (!runDir) {
    DLFLIB_LOG_ERROR("[UploaderComponent][uploadRunChunked] No file to upload");
    return false;
  }

  if (!runUuid) {
    DLFLIB_LOG_ERROR("[UploaderComponent][uploadRunChunked] Invalid run UUID");
    return false;
  }

  char baseUrl[256];
  snprintf(baseUrl, sizeof(baseUrl), endpointFmt_, runUuid);
  char chunkUrl[256];
  snprintf(chunkUrl, sizeof(chunkUrl), "%s/chunk", baseUrl);
  char finalizeUrl[256];
  snprintf(finalizeUrl, sizeof(finalizeUrl), "%s/finalize", baseUrl);

  char runDirPath[128];
  dlf::util::joinPath(runDirPath, sizeof(runDirPath), fsDir_, runUuid);
  char progressFilePath[128];
  dlf::util::joinPath(progressFilePath, sizeof(progressFilePath), runDirPath,
                      UPLOAD_PROGRESS_FILE);

  // Load persisted upload progress
  uint32_t metaNextChunkNum = 1, metaNextByteOffset = 0;
  uint32_t polledNextChunkNum = 1, polledNextByteOffset = 0;
  uint32_t eventNextChunkNum = 1, eventNextByteOffset = 0;
  loadUploadProgress(progressFilePath, metaNextChunkNum, metaNextByteOffset,
                     polledNextChunkNum, polledNextByteOffset,
                     eventNextChunkNum, eventNextByteOffset);
  DLFLIB_LOG_INFO(
      "[UploaderComponent][uploadRunChunked] Starting upload for %s "
      "(next byte offsets: meta=%u polled=%u event=%u)",
      runUuid, metaNextByteOffset, polledNextByteOffset, eventNextByteOffset);

  WiFiClient* wifiClient = getWiFiClient(strncmp(chunkUrl, "https", 5) == 0);
  HTTPClient httpClient;
  // Use an RAII guard to automatically end the HTTPClient when it goes out of
  // scope
  HTTPClientGuard httpClientGuard{httpClient};
  httpClient.setReuse(true);  // keep the TLS session alive between requests
  if (!httpClient.begin(*wifiClient, chunkUrl)) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][uploadRunChunked] HTTPClient::begin failed");
    return false;
  }

  // Upload remaining data for each file
  struct FileEntry {
    const char* name;
    uint32_t& nextChunkNum;
    uint32_t& nextByteOffset;
  };
  FileEntry entries[] = {
      {"meta.dlf", metaNextChunkNum, metaNextByteOffset},
      {"polled.dlf", polledNextChunkNum, polledNextByteOffset},
      {"event.dlf", eventNextChunkNum, eventNextByteOffset},
  };
  constexpr size_t numEntries = sizeof(entries) / sizeof(entries[0]);
  const char* uploadedFilenames[numEntries] = {};
  size_t numFilesUploaded = 0;
  for (size_t entryIdx = 0; entryIdx < numEntries; ++entryIdx) {
    const char* filename = entries[entryIdx].name;
    uint32_t& nextChunkNum = entries[entryIdx].nextChunkNum;
    uint32_t& nextByteOffset = entries[entryIdx].nextByteOffset;

    // Open the file
    char filePath[128];
    dlf::util::joinPath(filePath, sizeof(filePath), runDirPath, filename);
    fs::File file = fs_.open(filePath, "r");
    if (!file) {
      DLFLIB_LOG_INFO(
          "[UploaderComponent][uploadRunChunked] %s not found, skipping",
          filename);
      continue;
    }

    const size_t fileSize = file.size();
    if (fileSize == 0) {
      file.close();
      DLFLIB_LOG_INFO(
          "[UploaderComponent][uploadRunChunked] %s is empty, skipping",
          filename);
      continue;
    }

    if (nextByteOffset >= fileSize) {
      file.close();
      DLFLIB_LOG_INFO(
          "[UploaderComponent][uploadRunChunked] %s already fully uploaded "
          "(%u bytes)",
          filename, nextByteOffset);
      uploadedFilenames[numFilesUploaded++] = filename;
      continue;
    }

    // Seek to the next byte to upload
    if (!file.seek(nextByteOffset)) {
      file.close();
      DLFLIB_LOG_ERROR(
          "[UploaderComponent][uploadRunChunked] Seek failed for %s", filePath);
      return false;
    }

    DLFLIB_LOG_INFO(
        "[UploaderComponent][uploadRunChunked] Uploading %s starting at byte "
        "%u/%zu",
        filename, nextByteOffset, fileSize);

    // Send chunks to backend
    while (nextByteOffset < fileSize) {
      const size_t remaining = fileSize - nextByteOffset;
      const size_t chunkBytes =
          (remaining < maxChunkSize) ? remaining : maxChunkSize;
      if (!sendChunk(httpClient, runUuid, nextChunkNum, file, chunkBytes)) {
        file.close();
        DLFLIB_LOG_ERROR(
            "[UploaderComponent][uploadRunChunked] Chunk %u (byte %u) failed "
            "for "
            "%s. Aborting upload.",
            nextChunkNum, nextByteOffset, filename);
        return false;
      }

      nextChunkNum++;
      nextByteOffset += chunkBytes;
      DLFLIB_LOG_INFO(
          "[UploaderComponent][uploadRunChunked] %s chunk OK, %u/%zu bytes "
          "uploaded",
          filename, nextByteOffset, fileSize);

      // Update progress after each successful chunk
      saveUploadProgress(progressFilePath, metaNextChunkNum, metaNextByteOffset,
                         polledNextChunkNum, polledNextByteOffset,
                         eventNextChunkNum, eventNextByteOffset);
    }

    file.close();
    uploadedFilenames[numFilesUploaded++] = filename;
  }

  if (!finalize) {
    return true;
  }

  if (numFilesUploaded == 0) {
    DLFLIB_LOG_WARNING(
        "[UploaderComponent][uploadRunChunked] No files to finalize for %s",
        runUuid);
    return true;
  }

  // Send finalize request
  if (!sendFinalizeRequest(finalizeUrl, runUuid, uploadedFilenames,
                           numFilesUploaded, isActive)) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][uploadRunChunked] Finalize request failed for %s",
        runUuid);
    return false;
  }

  DLFLIB_LOG_INFO(
      "[UploaderComponent][uploadRunChunked] Upload complete for %s", runUuid);
  return true;
}

bool UploaderComponent::sendChunk(HTTPClient& httpClient, const char* runUuid,
                                  uint32_t chunkNumber, fs::File& file,
                                  size_t chunkBytes) {
  signer_.writeAuthHeaders(httpClient, runUuid);
  httpClient.addHeader("x-filename", file.name());
  httpClient.addHeader("x-chunk-number", String(chunkNumber));
  httpClient.addHeader("Content-Type", "application/octet-stream");

  int code = httpClient.sendRequest("POST", &file, chunkBytes);
  if (code < 200 || code >= 300) {
    DLFLIB_LOG_ERROR("[UploaderComponent][sendChunk] Server returned %d", code);
    return false;
  }

  return true;
}

bool UploaderComponent::sendFinalizeRequest(const char* finalizeUrl,
                                            const char* runUuid,
                                            const char* const* filenames,
                                            size_t numFiles, bool isActive) {
  // Build JSON body
  // Example: {"isActive":false,"files":["meta.dlf","polled.dlf"]}
  char body[256];
  int pos = snprintf(body, sizeof(body), "{\"isActive\":%s,\"files\":[",
                     isActive ? "true" : "false");
  bool firstFile = true;
  for (size_t fileIdx = 0; fileIdx < numFiles; ++fileIdx) {
    if (filenames[fileIdx] == nullptr) {
      continue;
    }
    pos += snprintf(body + pos, sizeof(body) - pos, "%s\"%s\"",
                    firstFile ? "" : ",", filenames[fileIdx]);
    firstFile = false;
  }
  snprintf(body + pos, sizeof(body) - pos, "]}");

  WiFiClient* wifiClient = getWiFiClient(strncmp(finalizeUrl, "https", 5) == 0);
  HTTPClient httpClient;
  HTTPClientGuard httpClientGuard{httpClient};
  if (!httpClient.begin(*wifiClient, finalizeUrl)) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][sendFinalizeRequest] HTTPClient::begin failed");
    return false;
  }

  signer_.writeAuthHeaders(httpClient, runUuid);
  httpClient.addHeader("Content-Type", "application/json");

  int code = httpClient.POST(body);
  if (code < 200 || code >= 300) {
    DLFLIB_LOG_ERROR(
        "[UploaderComponent][sendFinalizeRequest] Server returned %d", code);
    return false;
  }

  DLFLIB_LOG_INFO(
      "[UploaderComponent][sendFinalizeRequest] Finalize accepted (%d)", code);
  return true;
}

bool UploaderComponent::loadUploadProgress(const char* progressFilePath,
                                           uint32_t& metaNextChunkNum,
                                           uint32_t& metaNextByteOffset,
                                           uint32_t& polledNextChunkNum,
                                           uint32_t& polledNextByteOffset,
                                           uint32_t& eventNextChunkNum,
                                           uint32_t& eventNextByteOffset) {
  fs::File progressFile = fs_.open(progressFilePath, "r");
  if (!progressFile) {
    return false;
  }

  uint32_t buf[6] = {1, 0, 1, 0, 1, 0};
  if (progressFile.size() == sizeof(buf)) {
    progressFile.read(reinterpret_cast<uint8_t*>(buf), sizeof(buf));
  }
  progressFile.close();

  metaNextChunkNum = buf[0];
  metaNextByteOffset = buf[1];
  polledNextChunkNum = buf[2];
  polledNextByteOffset = buf[3];
  eventNextChunkNum = buf[4];
  eventNextByteOffset = buf[5];
  return true;
}

bool UploaderComponent::saveUploadProgress(const char* progressFilePath,
                                           uint32_t metaNextChunkNum,
                                           uint32_t metaNextByteOffset,
                                           uint32_t polledNextChunkNum,
                                           uint32_t polledNextByteOffset,
                                           uint32_t eventNextChunkNum,
                                           uint32_t eventNextByteOffset) {
  fs::File progressFile = fs_.open(progressFilePath, "w", true);
  if (!progressFile) {
    DLFLIB_LOG_WARNING(
        "[UploaderComponent][saveUploadProgress] Cannot write %s",
        progressFilePath);
    return false;
  }

  uint32_t buf[6] = {metaNextChunkNum,   metaNextByteOffset,
                     polledNextChunkNum, polledNextByteOffset,
                     eventNextChunkNum,  eventNextByteOffset};
  progressFile.write(reinterpret_cast<const uint8_t*>(buf), sizeof(buf));
  progressFile.close();
  return true;
}

}  // namespace dlf::components