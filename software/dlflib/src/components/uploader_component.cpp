#include "uploader_component.h"

#include "dlf_cfg.h"
#include "dlf_logger.h"

UploaderComponent::UploaderComponent(FS &fs, String fsDir, String host,
                                     uint16_t port)
    : fs_(fs), dir_(fsDir), host_(host), port_(port) {}

bool UploaderComponent::begin() {
  Serial.println("[UploaderComponent] begin");
  wifiEvent_ = xEventGroupCreate();

  // Initial state
  if (WiFi.status() == WL_CONNECTED) {
    xEventGroupSetBits(wifiEvent_, WLAN_READY);
  } else {
    xEventGroupClearBits(wifiEvent_, WLAN_READY);
  }

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

// https://arduino.stackexchange.com/questions/93818/arduinohttpclient-post-multipart-form-data-from-sd-card-returning-400-bad-reques
bool UploaderComponent::uploadRun(File runDir, String path) {
  WiFiClient client;

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

  // multipart boundary. Sent before each file.
  const char *boundaryTemplate =
      "\r\n--boundary1\r\n"
      "Content-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
      "Content-Type: application/octet-stream\r\n\r\n";

  // after this, post the file data.
  const char *closingContent = "\r\n--boundary1--\r\n";

  // Calculate overall message length
  // -2 to account for leading \r\n for initial boundary template actually being
  // part of header
  size_t msgLength = strlen(closingContent) - 2;

  for (File f; f = runDir.openNextFile();) {
    msgLength += snprintf(NULL, 0, boundaryTemplate, f.name()) + f.size();
    f.close();
  }
  runDir.rewindDirectory();

  // Send HTTP header
  client.printf(
      "POST %s HTTP/1.1\r\n"
      "Host: %s\r\n"
      "Content-Length: %ld\r\n"
      "Content-Type: multipart/form-data; boundary=boundary1\r\n",
      path.c_str(), host_, msgLength);

  // Send files
  const size_t chunkSize = 128;
  uint8_t buf[chunkSize];

  for (File f; f = runDir.openNextFile();) {
    // Send boundary
    client.printf(boundaryTemplate, f.name());

    // Send file data
    while (f.available()) {
      size_t num_read = f.read(buf, chunkSize);
      client.write(buf, num_read);
    }
    f.close();
  }
  client.print(closingContent);

  // Wait for response
  unsigned long timeout = millis();
  while (client.available() == 0) {
    if (millis() - timeout > 5000) {
      Serial.println("[UploaderComponent] Client RX Timeout");
      client.stop();
      return false;
    }
  }
  client.stop();

  return true;
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

    Serial.println("[UploaderComponent][syncTask] wlan ready - Beginning sync");

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

    xEventGroupWaitBits(logger->ev, CSCLogger::NEW_RUN, pdTRUE, pdTRUE,
                        portMAX_DELAY);
  }
}