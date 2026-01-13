#pragma once

#include <Arduino.h>
#include <FS.h>
#include <WiFi.h>

#include "../../oas-logger/lib/provision/include/DeviceAuth.h"
#include "dlflib/components/dlf_component.h"

namespace dlf::components {

class UploaderComponent : public DlfComponent {
 public:
  struct Options {
    // Delete the run data from the SD card after uploading
    bool deleteAfterUpload = false;
    // Adds a marker file to the run directory on the SD card after uploading
    bool markAfterUpload = true;
    // Attempts to upload the active runs' data at a regular interval. <= 0
    // disables partial run uploads.
    int partialRunUploadIntervalSecs = 0;
  };
  UploaderComponent(fs::FS& fs, const String& fsDir, const String& endpoint,
                    const String& deviceUid, const Options& options);
  void setSecurity(DeviceAuth* auth) { _auth = auth; }
  bool begin();
  bool uploadRun(fs::File runDir, const String& runUuid, bool isActive = false);
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

  DeviceAuth* _auth = nullptr;
  fs::FS& fs_;
  String dir_;
  String endpoint_;
  String deviceUid_;
  Options options_;
  // Used to notify when WiFi connected/disconnected
  EventGroupHandle_t wifiEvent_;
  // Used to notify when sync is in progress/complete
  EventGroupHandle_t syncEvent_;
};

}  // namespace dlf::components