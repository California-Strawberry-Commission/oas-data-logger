#include "uploader_component.h"

#include <WiFiClientSecure.h>

#include "dlf_cfg.h"
#include "dlf_logger.h"

UploaderComponent::UploaderComponent(FS &fs, String fsDir, String host,
                                     uint16_t port)
    : fs_(fs), dir_(fsDir), host_(host), port_(port) {}

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
  WiFiClientSecure client;
  client.setInsecure();

  if (!runDir) {
    Serial.println("[UploaderComponent] No file to upload");
    return false;
  }

  // Try to init client
  for (int retries = 0;
       retries++ < 3 && !client.connect(host_.c_str(), port_);) {
    Serial.println("[UploaderComponent] Failed to connect. Retrying in 1s...");
    vTaskDelay(pdMS_TO_TICKS(1000));
  }

  if (!client.connected()) {
    Serial.println(
        "[UploaderComponent] Failed to connect. Terminating attempt.");
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

  // Send POST request header
  Serial.println("[UploaderComponent] Sending upload request...");

  client.printf("POST %s HTTP/1.1\r\n", path.c_str());
  client.printf("Host: %s\r\n", host_.c_str());
  client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary);
  client.printf("Content-Length: %d\r\n", contentLength);
  client.println("Connection: close");
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
      String line = client.readStringUntil('\n');
      Serial.println(line);
      client.stop();
      return true;
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

    // TODO: Don't attempt to sync runs that have already been synced

    File runDir;
    int numFailures = 0;
    while (xEventGroupGetBits(uploaderComponent->wifiEvent_) & WLAN_READY &&
           (runDir = root.openNextFile()) && numFailures < 3) {
      // Skip syncing files, hidden dirs, system volume information dir, and
      // in-progress run directories
      if (!runDir.isDirectory() || runDir.name()[0] == '.' ||
          !strcmp(runDir.name(), "System Volume Information") ||
          logger->run_is_active(runDir.name())) {
        continue;
      }

      Serial.printf("[UploaderComponent][syncTask] Syncing: %s\n",
                    runDir.name());

      String path = String("/api/upload/") + runDir.name();
      numFailures += !uploaderComponent->uploadRun(runDir, path);
    }

    root.close();
    Serial.printf("[UploaderComponent][syncTask] Done syncing (failures: %d)\n",
                  numFailures);

    xEventGroupSetBits(uploaderComponent->syncEvent_, SYNC_COMPLETE);

    xEventGroupWaitBits(logger->ev, CSCLogger::NEW_RUN, pdTRUE, pdTRUE,
                        portMAX_DELAY);
  }
}