#include "device_health/device_health.h"

#include <esp_system.h>

#include "EzLog.h"
#include "heartbeat_client.h"
#include "reset_info.h"

namespace device_health {

namespace {

HeartbeatClient* heartbeatClient{nullptr};

void logResetInfo() {
  const ResetInfo& info{resetInfo()};
  EZLOG_INFO(
      "[device_health] Boot #%u: esp reset reason=%d, app reset reason=%d",
      info.bootCount, static_cast<int>(info.reason),
      static_cast<int>(info.appReason));
  if (info.crash.present) {
    EZLOG_ERROR(
        "[device_health] Crash (boot #%u): task=%s pc=0x%08x cause=%u "
        "vaddr=0x%08x",
        info.crash.bootCount, info.crash.task, info.crash.pc, info.crash.cause,
        info.crash.vaddr);
  }
}

}  // namespace

bool begin(const Config& config) {
  if (heartbeatClient) {
    return true;
  }

  captureResetInfo();
  logResetInfo();

  auto* client{new HeartbeatClient(config)};
  if (!client->begin()) {
    EZLOG_ERROR("[device_health] Failed to start heartbeat task");
    delete client;
    return false;
  }
  heartbeatClient = client;
  return true;
}

void restart(AppResetReason reason) {
  setAppResetReason(reason);
  ESP.restart();
}

bool sendHeartbeat() {
  if (!heartbeatClient) {
    return false;
  }
  return heartbeatClient->sendNow();
}

}  // namespace device_health
