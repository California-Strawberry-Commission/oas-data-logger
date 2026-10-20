#pragma once

#include <Arduino.h>

#include <atomic>

#include "ota_updater/ota_updater.h"

namespace ota {

/**
 * Runs OtaUpdater in a background FreeRTOS task. Whenever WiFi is connected,
 * it checks for an update and, if one is available, downloads and verifies it
 * into the inactive OTA partition and sets it as the boot partition, without
 * rebooting. The new firmware is installed on the next boot.
 *
 * An interrupted download leaves the boot partition unchanged, so it is safe
 * to reset or deep sleep at any time.
 */
class OtaBackgroundUpdater {
 public:
  using ResultCallback = void (*)(const OtaUpdater::UpdateResult& result);

  struct Options {
    // Delay before retrying after a failed check or download.
    uint32_t retryIntervalMs{5 * 60 * 1000};
    // Delay before checking again after finding the firmware up to date.
    uint32_t recheckIntervalMs{6 * 60 * 60 * 1000};
    // How often to check whether WiFi is connected while it is down.
    uint32_t wifiPollIntervalMs{10 * 1000};
    // Called from the background task after each update attempt. May be
    // nullptr.
    ResultCallback onResult{nullptr};
  };

  explicit OtaBackgroundUpdater(const OtaUpdater::Config& cfg,
                                const Options& opts);

  OtaBackgroundUpdater(const OtaBackgroundUpdater&) = delete;
  OtaBackgroundUpdater& operator=(const OtaBackgroundUpdater&) = delete;

  /**
   * Start the background task.
   *
   * @return Whether the task was started (or was already running).
   */
  bool begin();

  /**
   * Whether a new firmware image has been downloaded and set as the boot
   * partition. Once staged, the background task exits.
   */
  bool isUpdateStaged() const { return staged_.load(); }

  /**
   * Build number of the staged firmware, or -1 if none is staged.
   */
  int stagedBuildNumber() const { return stagedBuildNumber_.load(); }

  /**
   * Whether at least one update attempt has completed this session.
   */
  bool hasAttempted() const { return attempted_.load(); }

  /**
   * Whether an update attempt (manifest fetch or download) is running.
   */
  bool attemptInProgress() const { return inProgress_.load(); }

 private:
  OtaUpdater updater_;
  Options options_;
  TaskHandle_t taskHandle_{nullptr};
  std::atomic<bool> staged_{false};
  std::atomic<int> stagedBuildNumber_{-1};
  std::atomic<bool> attempted_{false};
  std::atomic<bool> inProgress_{false};

  static void taskEntry(void* arg);
  void run();
};

}  // namespace ota
