#pragma once
#include <Arduino.h>
#include <WiFi.h>

#include "dlf_base_component.h"
#include "dlf_cfg.h"

class CSCWifiClient : public BaseComponent {
 public:
  enum ev_e {
    WLAN_READY = 1,
  };
  EventGroupHandle_t ev;

  CSCWifiClient(String ssid, String password);

  bool begin();

  // https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/examples/WiFiClientEvents/WiFiClientEvents.ino
  void on_wifi_disconnect(arduino_event_id_t event, arduino_event_info_t info);

  void on_ip_get(arduino_event_id_t event, arduino_event_info_t info);

 private:
  String ssid;
  String password;
};