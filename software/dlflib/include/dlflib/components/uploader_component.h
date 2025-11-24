#pragma once

#include <Arduino.h>
#include <FS.h>
#include <WiFi.h>

#include "dlflib/components/dlf_component.h"

class UploaderComponent : public DlfComponent {
 public:
  static void syncTask(void* arg);

  struct Options {
    bool deleteAfterUpload = false;
    bool markAfterUpload = true;
  };
  UploaderComponent(FS& fs, const String& fsDir, const String& endpoint,
                    const String& deviceUid, const Options& options);
  bool begin();
  bool uploadRun(File runDir, const String& runUuid, bool isActive = false);
  void waitForSyncCompletion();

 private:
  enum WifiEvent {
    WLAN_READY = 1,
  };
  enum SyncEvent {
    SYNC_COMPLETE = 1,
  };

  // https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/examples/WiFiClientEvents/WiFiClientEvents.ino
  void onWifiDisconnected(arduino_event_id_t event, arduino_event_info_t info);
  void onWifiConnected(arduino_event_id_t event, arduino_event_info_t info);

  FS& fs_;
  String dir_;
  String endpoint_;
  String deviceUid_;
  Options options_;
  // Used to notify when WiFi connected/disconnected
  EventGroupHandle_t wifiEvent_;
  // Used to notify when sync is in progress/complete
  EventGroupHandle_t syncEvent_;
};