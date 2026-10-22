#pragma once

#include <Arduino.h>
#include <esp_system.h>

#include "device_health/device_health.h"

namespace device_health {

struct CrashInfo {
  bool present;
  // The boot that followed the crash (0 if unknown)
  uint32_t bootCount;
  char task[16];
  uint32_t pc;
  // Xtensa EXCCAUSE
  uint32_t cause;
  // Faulting address, e.g. 0x0 for a null dereference
  uint32_t vaddr;
  uint32_t backtrace[16];
  uint8_t backtraceDepth;
  bool backtraceCorrupted;
  // Prefix of the crashing app's ELF SHA256
  char elfSha256[17];
};

struct ResetInfo {
  uint32_t bootCount;
  esp_reset_reason_t reason;
  AppResetReason appReason;  // NONE unless reason is ESP_RST_SW
  CrashInfo crash;
};

/**
 * Capture reset info and increment the boot count. Subsequent calls do
 * nothing.
 */
void captureResetInfo();

const ResetInfo& resetInfo();

/**
 * Record why the firmware is about to restart. This will be picked up by
 * captureResetInfo() on the next boot.
 */
void setAppResetReason(AppResetReason reason);

/**
 * Erase the core dump once its summary has been reported, so it is not
 * reported again.
 */
void clearCrash();

}  // namespace device_health
