#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace device_health {

/**
 * Fixed-size log of events. When full, new events are dropped (except for those
 * coalesced into the latest event), so that the earliest events are kept.
 *
 * Event must be trivially copyable, and provide `bool coalesce(const Event&
 * next)`, which merges `next` into itself and returns true if they are
 * considered the same event, or returns false otherwise.
 *
 * The log lives in a caller-provided Storage struct so that it can be placed
 * in RTC_NOINIT memory and survive software resets and panics. The `magic`
 * field is used to check that RTC_NOINIT memory is valid.
 */
template <typename Event, size_t Capacity, uint32_t Magic>
class EventLog {
 public:
  static constexpr size_t CAPACITY{Capacity};

  struct Storage {
    uint32_t magic;
    uint8_t size;
    Event events[CAPACITY];
  };

  explicit EventLog(Storage& storage) : s_(storage) {
    // Reset storage if invalid
    if (s_.magic != Magic || s_.size > CAPACITY) {
      memset(&s_, 0, sizeof(s_));
      s_.magic = Magic;
    }
  }

  void record(const Event& event) {
    // Coalesce into previously recorded event if identical
    if (s_.size > 0 && s_.events[s_.size - 1].coalesce(event)) {
      return;
    }

    // If log is full, drop the new event
    if (s_.size == CAPACITY) {
      return;
    }

    s_.events[s_.size++] = event;
  }

  /**
   * Copy up to maxEvents events, oldest first, into out. Does not remove them.
   *
   * @return Number of events copied.
   */
  size_t peek(Event* out, size_t maxEvents) const {
    const size_t n{s_.size < maxEvents ? s_.size : maxEvents};
    memcpy(out, s_.events, n * sizeof(Event));
    return n;
  }

  /**
   * Remove the oldest n events.
   */
  void discard(size_t n) {
    if (n > s_.size) {
      n = s_.size;
    }
    memmove(&s_.events[0], &s_.events[n], (s_.size - n) * sizeof(Event));
    s_.size -= n;
  }

  size_t size() const { return s_.size; }

 private:
  Storage& s_;
};

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

  bool coalesce(const WifiDisconnectEvent& next) {
    if (next.bootCount != bootCount || next.reason != reason ||
        next.wasConnected != wasConnected || count == UINT16_MAX) {
      return false;
    }
    count++;
    lastUptimeMs = next.uptimeMs;
    rssi = next.rssi;
    return true;
  }
};

using WifiDisconnectLog =
    EventLog<WifiDisconnectEvent, 16, 0x57444C31>;  // "WDL1"

/**
 * An file write issue reported by dlflib. Consecutive events of the same type
 * for the same stream type are coalesced into one entry, with count and
 * lastUptimeMs updated.
 */
struct FileWriteIssueEvent {
  uint32_t bootCount;
  uint32_t uptimeMs;      // first occurrence
  uint32_t lastUptimeMs;  // latest occurrence
  uint32_t maxAttempts;
  uint32_t maxDurationMs;
  uint16_t count;
  uint8_t type;        // dlf::FileWriteIssue::Type
  uint8_t streamType;  // dlf::dlf_stream_type_e

  bool coalesce(const FileWriteIssueEvent& next) {
    if (next.bootCount != bootCount || next.type != type ||
        next.streamType != streamType || count == UINT16_MAX) {
      return false;
    }
    count++;
    lastUptimeMs = next.uptimeMs;
    if (next.maxAttempts > maxAttempts) {
      maxAttempts = next.maxAttempts;
    }
    if (next.maxDurationMs > maxDurationMs) {
      maxDurationMs = next.maxDurationMs;
    }
    return true;
  }
};

using FileWriteIssueLog =
    EventLog<FileWriteIssueEvent, 16, 0x46574C31>;  // "FWL1"

/**
 * A log line. Consecutive lines from the same source location are coalesced
 * into one entry, with count and lastUptimeMs updated and the latest message
 * kept.
 */
struct LogLineEvent {
  static constexpr size_t FILE_LEN{24};
  static constexpr size_t MSG_LEN{96};

  uint32_t bootCount;
  uint32_t uptimeMs;      // first occurrence
  uint32_t lastUptimeMs;  // latest occurrence
  uint16_t count;
  uint8_t level;  // ezlog::Level
  uint16_t line;
  char file[FILE_LEN];  // NUL-terminated
  char msg[MSG_LEN];    // NUL-terminated, latest occurrence

  static LogLineEvent make(uint32_t bootCount, uint32_t uptimeMs, uint8_t level,
                           const char* file, uint16_t line, const char* msg) {
    LogLineEvent e{bootCount, uptimeMs, uptimeMs, 1, level, line, {}, {}};
    copyTruncated(e.file, file);
    copyTruncated(e.msg, msg);
    return e;
  }

  bool coalesce(const LogLineEvent& next) {
    if (next.bootCount != bootCount || next.line != line ||
        strcmp(next.file, file) != 0 || count == UINT16_MAX) {
      return false;
    }
    count++;
    lastUptimeMs = next.uptimeMs;
    level = next.level;
    memcpy(msg, next.msg, sizeof(msg));
    return true;
  }

 private:
  template <size_t N>
  static void copyTruncated(char (&dst)[N], const char* src) {
    if (!src) {
      dst[0] = '\0';
      return;
    }
    strncpy(dst, src, N - 1);
    dst[N - 1] = '\0';
  }
};

using LogLineLog = EventLog<LogLineEvent, 16, 0x4C4C4C31>;  // "LLL1"

}  // namespace device_health
