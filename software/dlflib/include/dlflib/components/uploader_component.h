#pragma once

#include <Arduino.h>
#include <FS.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "dlflib/auth/request_signer.h"
#include "dlflib/components/component.h"

namespace dlf::components {

class UploaderComponent : public Component {
 public:
  enum class RetentionMode : uint8_t {
    KEEP,   // keep run data on SD card (no marker, no deletion)
    MARK,   // add upload marker file after successful upload
    DELETE  // delete run data after successful upload
  };

  struct Options {
    RetentionMode retentionMode = RetentionMode::MARK;
    // Secret used to sign upload requests. nullptr or empty string disables
    // signing.
    const char* secret = nullptr;
    // Attempts to upload the active runs' data at a regular interval. <= 0
    // disables partial run uploads.
    int partialRunUploadIntervalSecs = 0;
  };

  UploaderComponent(fs::FS& fs, const char* fsDir, const char* endpointFmt,
                    const char* deviceUid, const Options& options);

  bool begin() override;
  bool uploadRun(fs::File runDir, const char* runUuid, bool isActive = false);
  void waitForSyncCompletion();

 private:
  enum WifiEvent {
    WLAN_READY = 1,
  };
  enum SyncEvent {
    SYNC_COMPLETE = 1,
  };

  static void syncTask(void* arg);
  static void partialRunUploadTask(void* arg);

  // https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/examples/WiFiClientEvents/WiFiClientEvents.ino
  void onWifiDisconnected(arduino_event_id_t event, arduino_event_info_t info);
  void onWifiConnected(arduino_event_id_t event, arduino_event_info_t info);
  WiFiClient* getWiFiClient(bool secure = true);
  WiFiClient* connectToEndpoint(const char* url, int maxRetries = 3,
                                uint32_t retryDelayMs = 500);
  bool deleteRunDir(fs::File runDir, const char* runDirPath);

  std::unique_ptr<WiFiClient> wifiClient_;
  std::unique_ptr<WiFiClientSecure> wifiClientSecure_;
  dlf::auth::RequestSigner signer_;
  fs::FS& fs_;
  char fsDir_[128];
  char endpointFmt_[256];
  Options options_;
  // Used to notify when WiFi connected/disconnected
  EventGroupHandle_t wifiEvent_;
  // Used to notify when sync is in progress/complete
  EventGroupHandle_t syncEvent_;
};

}  // namespace dlf::components