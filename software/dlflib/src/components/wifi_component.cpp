#include "wifi_component.h"

#include <Arduino.h>
#include <WiFi.h>

#include <functional>

#define BIND_EVENT_CB(fn) \
  std::bind(&fn, this, std::placeholders::_1, std::placeholders::_2)

WifiComponent::WifiComponent(String ssid, String password)
    : ssid_(ssid), password_(password) {}

bool WifiComponent::begin() {
  Serial.println("WifiComponent begin");

  ev = xEventGroupCreate();

  WiFi.onEvent(BIND_EVENT_CB(WifiComponent::onDisconnected),
               ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.onEvent(BIND_EVENT_CB(WifiComponent::onGotIp),
               ARDUINO_EVENT_WIFI_STA_GOT_IP);

  WiFi.disconnect(true);
  WiFi.begin(ssid_.c_str(), password_.c_str());

  return true;
}

void WifiComponent::onDisconnected(arduino_event_id_t event,
                                   arduino_event_info_t info) {
  Serial.println("WiFi disconnected");
  xEventGroupClearBits(ev, WLAN_READY);
  WiFi.begin(ssid_.c_str(), password_.c_str());
}

void WifiComponent::onGotIp(arduino_event_id_t event,
                            arduino_event_info_t info) {
  Serial.println("WiFi connected");
  xEventGroupSetBits(ev, WLAN_READY);
}
