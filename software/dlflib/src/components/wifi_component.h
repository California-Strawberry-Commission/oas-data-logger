#pragma once

#include <Arduino.h>
#include <WiFi.h>

#include "dlf_cfg.h"
#include "dlf_component.h"

class WifiComponent : public DlfComponent {
 public:
  enum ev_e {
    WLAN_READY = 1,
  };
  EventGroupHandle_t ev;

  WifiComponent(String ssid, String password);

  bool begin();

 private:
  // https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/examples/WiFiClientEvents/WiFiClientEvents.ino
  void onDisconnected(arduino_event_id_t event, arduino_event_info_t info);

  void onGotIp(arduino_event_id_t event, arduino_event_info_t info);

  String ssid_;
  String password_;
};