#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <dlflib/auth/request_signer.h>
#include <dlflib/dlf_logfile.h>

#include "EzLog.h"
#include "device_health/device_health.h"
#include "device_health/event_log.h"

namespace device_health {

/**
 * Sends heartbeats from a background FreeRTOS task when the task starts,
 * whenever Wi-Fi connects, and every intervalMs while connected.
 *
 * Also records Wi-Fi disconnects, file write issues and recent ERROR log
 * lines (in RTC memory, so they survive software resets and panics). Reported
 * events and the core dump are cleared only once the server acknowledges a
 * heartbeat.
 */
class HeartbeatClient {
 public:
  explicit HeartbeatClient(const Config& cfg);
  ~HeartbeatClient();

  HeartbeatClient(const HeartbeatClient&) = delete;
  HeartbeatClient& operator=(const HeartbeatClient&) = delete;

  /**
   * Start the background task and start handling Wi-Fi events, dlflib file
   * write issues and ezlog ERROR lines. Call once.
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
  FileWriteIssueLog fileWriteIssueLog_;
  // Guards fileWriteIssueLog_, which is written from dlflib's flusher tasks
  portMUX_TYPE fileWriteIssueLogMux_ = portMUX_INITIALIZER_UNLOCKED;
  LogLineLog logLineLog_;
  // Guards logLineLog_, which is written from any task that logs
  portMUX_TYPE logLineLogMux_ = portMUX_INITIALIZER_UNLOCKED;
  // Log lines peeked for the heartbeat being sent, since it may be too large
  // for the heartbeat task's stack
  LogLineEvent logLinesToSend_[LogLineLog::CAPACITY];
  volatile bool wifiConnected_{false};

  void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
  // Called from dlflib's flusher tasks, so must not block
  void recordFileWriteIssue(const dlf::FileWriteIssue& issue);
  // Called from ezlog on any task that logs, so must not block or log
  void recordLogLine(ezlog::Level level, const char* file, uint16_t line,
                     const char* msg);
  static void taskEntry(void* arg);
  void run();
  // Caller must hold sendMutex_
  bool send();
};

}  // namespace device_health
