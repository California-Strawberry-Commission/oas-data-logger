#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <dlflib/auth/request_signer.h>

#include "device_health/device_health.h"
#include "device_health/wifi_disconnect_log.h"

namespace device_health {

/**
 * Sends heartbeats from a background FreeRTOS task when the task starts,
 * whenever Wi-Fi connects, and every intervalMs while connected.
 *
 * Also records Wi-Fi disconnects (in RTC memory, so they survive software
 * resets and panics). Reported disconnect events and the core dump are cleared
 * only once the server acknowledges a heartbeat.
 */
class HeartbeatClient {
 public:
  explicit HeartbeatClient(const Config& cfg);
  ~HeartbeatClient();

  HeartbeatClient(const HeartbeatClient&) = delete;
  HeartbeatClient& operator=(const HeartbeatClient&) = delete;

  /**
   * Start the background task and start handling Wi-Fi events. Call once.
   *
   * @return Whether the task was started.
   */
  bool begin();

  /**
   * Send a heartbeat on the calling task, if Wi-Fi is connected. Waits for any
   * heartbeat in progress on the background task to finish first.
   *
   * @return Whether the heartbeat was acknowledged by the server.
   */
  bool sendNow();

 private:
  Config config_;
  dlf::auth::RequestSigner signer_;
  TaskHandle_t taskHandle_{nullptr};
  // Ensures only one heartbeat is sent at a time
  SemaphoreHandle_t sendMutex_;
  WifiDisconnectLog disconnectLog_;
  // Guards disconnectLog_, which is written from the WiFi event task
  portMUX_TYPE disconnectLogMux_ = portMUX_INITIALIZER_UNLOCKED;
  volatile bool wifiConnected_{false};

  void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
  static void taskEntry(void* arg);
  void run();
  // Caller must hold sendMutex_
  bool send();
};

}  // namespace device_health
