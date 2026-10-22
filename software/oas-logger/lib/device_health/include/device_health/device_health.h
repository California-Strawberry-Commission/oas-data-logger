#pragma once

#include <Arduino.h>

/**
 * Device health reporting. Periodically POSTs a signed heartbeat to the server
 * with firmware build, why the device last reset (including a crash summary
 * from the core dump partition after a panic), heap, RSSI and any Wi-Fi
 * disconnects since the last heartbeat.
 *
 * Usage:
 * - Call begin() once, early in setup().
 * - Call restart() instead of ESP.restart(), so the reason gets reported.
 * - Optionally call sendHeartbeat() before deep sleep.
 */
namespace device_health {

// Why the firmware restarted itself. Reported alongside ESP_RST_SW, which
// esp_reset_reason() returns for any ESP.restart().
enum class AppResetReason : uint8_t {
  NONE = 0,
  ERROR_STATE = 1,
  WIFI_RESET_BUTTON = 2,
};

struct Config {
  char endpoint[128]{0};
  char deviceId[13]{0};
  char deviceSecret[65]{0};
  // PEM-encoded CA certificate. If nullptr, certificate validation is skipped
  // (insecure).
  const char* caCert{nullptr};
  int firmwareBuild{0};
  char deviceType[16]{0};  // "V0" or "V1"
  char otaChannel[16]{0};  // "STABLE" or "BETA"
  // Returns the current application state. Called from the heartbeat task. May
  // be nullptr.
  int (*state)(){nullptr};
  uint32_t intervalMs{5 * 60 * 1000};
  // Request timeout
  uint32_t timeoutMs{10 * 1000};
};

/**
 * Records why the device reset, reads any crash summary, starts tracking Wi-Fi
 * disconnects and starts the heartbeat task. A heartbeat is sent whenever
 * Wi-Fi connects, and every intervalMs while connected.
 *
 * Call once, as early in setup() as possible.
 *
 * @return Whether the heartbeat task was started (or was already running).
 */
bool begin(const Config& config);

/**
 * Record why the firmware is restarting, then restart.
 */
void restart(AppResetReason reason);

/**
 * Send a heartbeat now on the calling task, if Wi-Fi is connected. Blocks until
 * it completes (or fails or times out).
 *
 * @return Whether the heartbeat was acknowledged by the server.
 */
bool sendHeartbeat();

}  // namespace device_health
