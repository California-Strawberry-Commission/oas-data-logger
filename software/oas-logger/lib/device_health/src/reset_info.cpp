#include "reset_info.h"

#include <Preferences.h>
#include <esp_core_dump.h>

namespace device_health {

namespace {

constexpr uint32_t APP_RESET_REASON_MARKER_MAGIC{0x52535431};  // "RST1"

struct AppResetReasonMarker {
  uint32_t magic;
  uint8_t reason;
};

// RTC_NOINIT memory survives resets where the device stays powered (software
// resets, panics), but contents are garbage after power off then power on. The
// `magic` field is used to check that RTC_NOINIT memory is valid.
RTC_NOINIT_ATTR AppResetReasonMarker appResetReasonMarker;

ResetInfo resetInfo_{};

const char* PREFS_NAMESPACE{"device_health"};

// Increments the boot count and, if this boot followed a panic, remembers it
// as the boot the core dump belongs to.
void updateBootCounters(ResetInfo& info) {
  Preferences prefs;
  if (!prefs.begin(PREFS_NAMESPACE, /*readOnly=*/false)) {
    info.bootCount = 0;
    info.crash.bootCount = 0;
    return;
  }

  // Increment boot count
  info.bootCount = prefs.getUInt("boot", 0) + 1;
  prefs.putUInt("boot", info.bootCount);

  // "crash_boot" maintains the boot count of the last crash, so info.crash can
  // be repopulated with the right boot count on any subsequent boots.
  if (info.reason == ESP_RST_PANIC) {
    prefs.putUInt("crash_boot", info.bootCount);
  }
  info.crash.bootCount = prefs.getUInt("crash_boot", 0);

  prefs.end();
}

void readCrash(CrashInfo& crash) {
  if (esp_core_dump_image_check() != ESP_OK) {
    return;
  }

  esp_core_dump_summary_t summary;
  if (esp_core_dump_get_summary(&summary) != ESP_OK) {
    return;
  }

  crash.present = true;
  strlcpy(crash.task, summary.exc_task, sizeof(crash.task));
  crash.pc = summary.exc_pc;
  crash.cause = summary.ex_info.exc_cause;
  crash.vaddr = summary.ex_info.exc_vaddr;
  const uint32_t depth{summary.exc_bt_info.depth};
  crash.backtraceDepth = depth < 16 ? depth : 16;
  memcpy(crash.backtrace, summary.exc_bt_info.bt,
         crash.backtraceDepth * sizeof(uint32_t));
  crash.backtraceCorrupted = summary.exc_bt_info.corrupted;
  strlcpy(crash.elfSha256,
          reinterpret_cast<const char*>(summary.app_elf_sha256),
          sizeof(crash.elfSha256));
}

}  // namespace

void captureResetInfo() {
  // Ensure subsequent calls to captureResetInfo do nothing, so that the boot
  // count isn't incremented again.
  static bool captured{false};
  if (captured) {
    return;
  }
  captured = true;

  // Get reason of last reset
  resetInfo_.reason = esp_reset_reason();

  // Updates boot count and populates the ResetInfo
  updateBootCounters(resetInfo_);

  // If the reset was due to SW (ESP.restart() was called), get the
  // saved AppResetReason
  resetInfo_.appReason = AppResetReason::NONE;
  if (appResetReasonMarker.magic == APP_RESET_REASON_MARKER_MAGIC &&
      resetInfo_.reason == ESP_RST_SW) {
    resetInfo_.appReason =
        static_cast<AppResetReason>(appResetReasonMarker.reason);
  }
  // Clear the restartMarker
  appResetReasonMarker.magic = 0;

  // Populate CrashInfo. The core dump stays in flash until clearCrash() is
  // called
  readCrash(resetInfo_.crash);
}

const ResetInfo& resetInfo() { return resetInfo_; }

void setAppResetReason(AppResetReason reason) {
  appResetReasonMarker.magic = APP_RESET_REASON_MARKER_MAGIC;
  appResetReasonMarker.reason = static_cast<uint8_t>(reason);
}

void clearCrash() {
  if (!resetInfo_.crash.present) {
    return;
  }
  esp_core_dump_image_erase();
  resetInfo_.crash.present = false;
}

}  // namespace device_health
