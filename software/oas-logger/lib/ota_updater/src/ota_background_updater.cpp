#include "ota_updater/ota_background_updater.h"

#include <WiFi.h>

namespace ota {

OtaBackgroundUpdater::OtaBackgroundUpdater(const OtaUpdater::Config& cfg,
                                           const Options& opts)
    : updater_(cfg), options_(opts) {}

bool OtaBackgroundUpdater::begin() {
  if (taskHandle_ != nullptr || staged_.load()) {
    return true;
  }

  return xTaskCreate(taskEntry, "ota", 8192, this, 1, &taskHandle_) == pdPASS;
}

void OtaBackgroundUpdater::taskEntry(void* arg) {
  static_cast<OtaBackgroundUpdater*>(arg)->run();
  vTaskDelete(nullptr);
}

void OtaBackgroundUpdater::run() {
  while (true) {
    if (WiFi.status() != WL_CONNECTED) {
      vTaskDelay(pdMS_TO_TICKS(options_.wifiPollIntervalMs));
      continue;
    }

    inProgress_ = true;
    const auto res{updater_.updateIfAvailable(/*rebootOnSuccess=*/false)};
    inProgress_ = false;
    attempted_ = true;

    if (options_.onResult) {
      options_.onResult(res);
    }

    if (res.ok && res.updateApplied) {
      // New firmware is set as the boot partition. End the task.
      stagedBuildNumber_ = res.newBuildNumber;
      staged_ = true;
      return;
    }

    vTaskDelay(pdMS_TO_TICKS(res.ok ? options_.recheckIntervalMs
                                    : options_.retryIntervalMs));
  }
}

}  // namespace ota
