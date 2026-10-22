#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace device_health {

/**
 * A Wi-Fi disconnect or failed connection attempt, as reported by the
 * STA_DISCONNECTED event. Consecutive identical events are coalesced into one
 * entry, with count and lastUptimeMs updated.
 */
struct WifiDisconnectEvent {
  uint32_t bootCount;
  uint32_t uptimeMs;      // first occurrence
  uint32_t lastUptimeMs;  // latest occurrence
  uint16_t count;
  uint8_t reason;  // wifi_err_reason_t
  int8_t rssi;
  bool wasConnected;  // false means a connection attempt failed
};

/**
 * Fixed-size log of Wi-Fi disconnect events. When full, the oldest event is
 * dropped.
 *
 * The log lives in a caller-provided Storage struct so that it can be placed
 * in RTC_NOINIT memory and survive software resets and panics. The `magic`
 * field is used to check that RTC_NOINIT memory is valid.
 */
class WifiDisconnectLog {
 public:
  static constexpr size_t CAPACITY{16};

  struct Storage {
    uint32_t magic;
    uint8_t size;
    WifiDisconnectEvent events[CAPACITY];
  };

  explicit WifiDisconnectLog(Storage& storage) : s_(storage) {
    // Reset storage if invalid
    if (s_.magic != MAGIC || s_.size > CAPACITY) {
      memset(&s_, 0, sizeof(s_));
      s_.magic = MAGIC;
    }
  }

  void record(uint32_t bootCount, uint32_t uptimeMs, uint8_t reason,
              int8_t rssi, bool wasConnected) {
    // Coalesce into previously recorded event if identical
    if (s_.size > 0) {
      WifiDisconnectEvent& last{s_.events[s_.size - 1]};
      if (last.bootCount == bootCount && last.reason == reason &&
          last.wasConnected == wasConnected && last.count < UINT16_MAX) {
        last.count++;
        last.lastUptimeMs = uptimeMs;
        last.rssi = rssi;
        return;
      }
    }

    // If log is full, drop the oldest event
    if (s_.size == CAPACITY) {
      memmove(&s_.events[0], &s_.events[1],
              (CAPACITY - 1) * sizeof(WifiDisconnectEvent));
      s_.size--;
    }

    s_.events[s_.size++] = {bootCount, uptimeMs, uptimeMs,    1,
                            reason,    rssi,     wasConnected};
  }

  /**
   * Copy up to maxEvents events, oldest first, into out. Does not remove them.
   *
   * @return Number of events copied.
   */
  size_t peek(WifiDisconnectEvent* out, size_t maxEvents) const {
    const size_t n{s_.size < maxEvents ? s_.size : maxEvents};
    memcpy(out, s_.events, n * sizeof(WifiDisconnectEvent));
    return n;
  }

  /**
   * Remove the oldest n events.
   */
  void discard(size_t n) {
    if (n > s_.size) {
      n = s_.size;
    }
    memmove(&s_.events[0], &s_.events[n],
            (s_.size - n) * sizeof(WifiDisconnectEvent));
    s_.size -= n;
  }

  size_t size() const { return s_.size; }

 private:
  static constexpr uint32_t MAGIC{0x57454C31};  // "WEL1"

  Storage& s_;
};

}  // namespace device_health
