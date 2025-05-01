#pragma once

#include <Arduino.h>
#include <FS.h>
#include <WiFi.h>

#include "dlf_component.h"

class UploaderComponent : public DlfComponent {
 public:
  static void syncTask(void *arg);

  UploaderComponent(FS &fs, String fsDir, String host, uint16_t port);
  bool begin();
  bool uploadRun(File runDir, String path);

 private:
  enum WifiEvent {
    WLAN_READY = 1,
  };

  // https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/examples/WiFiClientEvents/WiFiClientEvents.ino
  void onWifiDisconnected(arduino_event_id_t event, arduino_event_info_t info);
  void onWifiConnected(arduino_event_id_t event, arduino_event_info_t info);

  FS &fs_;
  String dir_;
  String host_;
  uint16_t port_;
  size_t maxRetries_;
  EventGroupHandle_t wifiEvent_;
};