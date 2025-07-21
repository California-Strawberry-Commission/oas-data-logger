#include "uploader_component.h"

#include <WiFiClientSecure.h>
#include <WiFiClient.h>

#include "dlf_cfg.h"
#include "dlf_logger.h"

UploaderComponent::UploaderComponent(FS &fs, String fsDir, String host,
                                     uint16_t port, const Options &options)
    : fs_(fs), dir_(fsDir), host_(host), port_(port), options_(options) {}

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

bool UploaderComponent::uploadRun(File runDir, String path) {
  //WiFiClient client; 
  WiFiClientSecure client;
  client.setInsecure();
  
  Serial.println("\n=== UPLOAD DEBUG INFO ===");
  Serial.printf("Host: %s\n", host_.c_str());
  Serial.printf("Port: %d\n", port_);
  Serial.printf("Path: %s\n", path.c_str());
  Serial.printf("URL: http://%s:%d%s\n", host_.c_str(), port_, path.c_str());

  if (!runDir) {
    Serial.println("[UploaderComponent] No file to upload");
    return false;
  }

  // List files to be uploaded
  Serial.println("Files to upload:");
  runDir.rewindDirectory();
  File tempFile;
  while (tempFile = runDir.openNextFile()) {
    Serial.printf("  - %s (%d bytes)\n", tempFile.name(), tempFile.size());
    tempFile.close();
  }

  // Try to connect
  Serial.printf("Attempting connection to %s:%d...\n", host_.c_str(), port_);
  
  for (int retries = 0; retries < 3; retries++) {
    if (client.connect(host_.c_str(), port_)) {
      Serial.println("Connected successfully!");
      break;
    }
    Serial.printf("Connection attempt %d failed. ", retries + 1);
    if (retries < 2) {
      Serial.println("Retrying in 1s...");
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }

  if (!client.connected()) {
    Serial.println("[UploaderComponent] Failed to connect after 3 attempts.");
    return false;
  }

  // Create request
  // Note that we need to manually construct the multipart/form-data body, and
  // each file must be streamed (avoid fully loading into memory)
  const char *boundary = "dlfboundary";
  const char *boundaryTemplate =
      "--dlfboundary\r\n"
      "Content-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
      "Content-Type: application/octet-stream\r\n\r\n";
  const char *endBoundary = "--dlfboundary--\r\n";

  // First, calculate the content length (which needs to go into the request
  // header)
  size_t contentLength = 0;
  runDir.rewindDirectory();
  File file = runDir.openNextFile();
  while (file) {
    contentLength += snprintf(NULL, 0, boundaryTemplate, file.name());
    contentLength += file.size();
    contentLength += 2;  // for trailing \r\n after file content
    file.close();
    file = runDir.openNextFile();
  }
  contentLength += strlen(endBoundary);

  // Debug print out header information.
  Serial.println("\n=== HTTP REQUEST ===");
  Serial.printf("POST %s HTTP/1.1\r\n", path.c_str());
  Serial.printf("Host: %s\r\n", host_.c_str());
  Serial.printf("Content-Type: multipart/form-data; boundary=dlfboundary\r\n");
  Serial.printf("Content-Length: %zu\r\n", contentLength);
  Serial.println("Connection: close\r\n");
  Serial.println("===================\n");

  // Send POST request header
  Serial.println("[UploaderComponent] Sending upload request...");

  client.printf("POST %s HTTP/1.1\r\n", path.c_str());
  client.printf("Host: %s\r\n", host_.c_str());
  client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary);
  client.printf("Content-Length: %zu\r\n", contentLength);
  client.println("Connection: close\r\n");
  client.println();  // end of headers

  // Send boundaries and file data
  runDir.rewindDirectory();
  const size_t chunkSize = 128;
  uint8_t buf[chunkSize];
  file = runDir.openNextFile();
  while (file) {
    // Send boundary
    client.printf(boundaryTemplate, file.name());

    // Send file data
    while (file.available()) {
      size_t len = file.read(buf, chunkSize);
      client.write(buf, len);
    }
    client.print("\r\n");
    file.close();
    file = runDir.openNextFile();
  }
  client.print(endBoundary);

  // Wait for response
  unsigned long startMillis = millis();
  while (client.connected() && millis() - startMillis < 5000) {
    if (client.available()) {
      // We don't need to process the full response body, so return as soon as
      // we receive a line
      String statusLine = client.readStringUntil('\n');
      Serial.println("[UploaderComponent] Response: " + statusLine);
      client.stop();

      return statusLine.startsWith("HTTP/1.1 200") ||
             statusLine.startsWith("HTTP/1.0 200");
    }
  }

  Serial.println("[UploaderComponent] No response received within 5 seconds");
  client.stop();
  return false;
}

void UploaderComponent::waitForSyncCompletion() {
  xEventGroupWaitBits(syncEvent_, SYNC_COMPLETE, pdFALSE, pdTRUE,
                      portMAX_DELAY);
}

void UploaderComponent::syncTask(void *arg) {
  UploaderComponent *uploaderComponent = static_cast<UploaderComponent *>(arg);
  CSCLogger *logger = uploaderComponent->getComponent<CSCLogger>();

  if (!logger) {
    Serial.println(
        "[UploaderComponent][syncTask] NO LOGGER. This should not happen");
    vTaskDelete(NULL);
  }

  while (true) {
    // Make sure SD is inserted and provided path is a dir
    File root = uploaderComponent->fs_.open(uploaderComponent->dir_);
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

    File runDir;
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
      File file;
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

      String path = String("/api/upload/") + runDir.name();
      bool uploadSuccess = uploaderComponent->uploadRun(runDir, path);
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
          File f = uploaderComponent->fs_.open(markerFilePath, "w", true);
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