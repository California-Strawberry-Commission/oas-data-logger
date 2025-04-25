#include "dlf_wifi.h"

#include <Arduino.h>
#include <WiFi.h>

#include <functional>

#define BIND_EVENT_CB(fn) std::bind(&fn, this, std::placeholders::_1, std::placeholders::_2)

CSCWifiClient::CSCWifiClient(String ssid, String password) : ssid(ssid), password(password) {
}

bool CSCWifiClient::begin() {
    Serial.println("Wifi init");

    ev = xEventGroupCreate();

    WiFi.onEvent(BIND_EVENT_CB(CSCWifiClient::on_wifi_disconnect), ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
    WiFi.onEvent(BIND_EVENT_CB(CSCWifiClient::on_ip_get), ARDUINO_EVENT_WIFI_STA_GOT_IP);

    WiFi.disconnect(true);
    WiFi.begin(ssid.c_str(), password.c_str());

    return true;
}

void CSCWifiClient::on_wifi_disconnect(arduino_event_id_t event, arduino_event_info_t info) {
    // Serial.println("WIFI DISCONNECT");
    xEventGroupClearBits(ev, WLAN_READY);
    WiFi.begin(ssid.c_str(), password.c_str());
}

void CSCWifiClient::on_ip_get(arduino_event_id_t event, arduino_event_info_t info) {
    Serial.println("WiFi connected!");
    xEventGroupSetBits(ev, WLAN_READY);
}
