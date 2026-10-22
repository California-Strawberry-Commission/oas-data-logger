#include <gtest/gtest.h>

#include "device_health/wifi_disconnect_log.h"

using device_health::WifiDisconnectEvent;
using device_health::WifiDisconnectLog;

namespace {

constexpr uint8_t NO_AP_FOUND{201};
constexpr uint8_t AUTH_FAIL{202};
constexpr uint8_t BEACON_TIMEOUT{200};

class WifiDisconnectLogTest : public ::testing::Test {
 protected:
  WifiDisconnectLog::Storage storage{};
  WifiDisconnectEvent out[WifiDisconnectLog::CAPACITY];
};

}  // namespace

TEST_F(WifiDisconnectLogTest, StartsEmpty) {
  WifiDisconnectLog log{storage};
  EXPECT_EQ(log.size(), 0);
  EXPECT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 0);
}

TEST_F(WifiDisconnectLogTest, RecordsEvent) {
  WifiDisconnectLog log{storage};
  log.record(1, 1000, BEACON_TIMEOUT, -70, true);

  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);
  EXPECT_EQ(out[0].bootCount, 1);
  EXPECT_EQ(out[0].uptimeMs, 1000);
  EXPECT_EQ(out[0].lastUptimeMs, 1000);
  EXPECT_EQ(out[0].count, 1);
  EXPECT_EQ(out[0].reason, BEACON_TIMEOUT);
  EXPECT_EQ(out[0].rssi, -70);
  EXPECT_TRUE(out[0].wasConnected);
}

TEST_F(WifiDisconnectLogTest, CoalescesIdenticalConsecutiveEvents) {
  WifiDisconnectLog log{storage};
  log.record(1, 1000, NO_AP_FOUND, -90, false);
  log.record(1, 2000, NO_AP_FOUND, -91, false);
  log.record(1, 3000, NO_AP_FOUND, -92, false);

  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);
  EXPECT_EQ(out[0].count, 3);
  EXPECT_EQ(out[0].uptimeMs, 1000);
  EXPECT_EQ(out[0].lastUptimeMs, 3000);
  EXPECT_EQ(out[0].rssi, -92);
}

TEST_F(WifiDisconnectLogTest, DoesNotCoalesceDifferentEvents) {
  WifiDisconnectLog log{storage};
  log.record(1, 1000, NO_AP_FOUND, -90, false);
  log.record(1, 2000, AUTH_FAIL, -60, false);
  log.record(1, 3000, AUTH_FAIL, -60, true);  // different wasConnected
  log.record(2, 4000, AUTH_FAIL, -60, true);  // different boot count

  EXPECT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 4);
}

TEST_F(WifiDisconnectLogTest, DropsOldestEventsWhenFull) {
  WifiDisconnectLog log{storage};
  const size_t total{WifiDisconnectLog::CAPACITY + 5};
  for (size_t i{0}; i < total; i++) {
    // Alternate reasons so that events are not coalesced
    log.record(1, i, i % 2 ? NO_AP_FOUND : AUTH_FAIL, -90, false);
  }

  EXPECT_EQ(log.size(), WifiDisconnectLog::CAPACITY);
  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY),
            WifiDisconnectLog::CAPACITY);
  EXPECT_EQ(out[0].uptimeMs, 5);
  EXPECT_EQ(out[WifiDisconnectLog::CAPACITY - 1].uptimeMs, total - 1);
}

TEST_F(WifiDisconnectLogTest, PeekDoesNotClear) {
  WifiDisconnectLog log{storage};
  log.record(1, 1000, NO_AP_FOUND, -90, false);
  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);

  EXPECT_EQ(log.size(), 1);
  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);
  EXPECT_EQ(out[0].reason, NO_AP_FOUND);
}

TEST_F(WifiDisconnectLogTest, DiscardRemovesOldest) {
  WifiDisconnectLog log{storage};
  log.record(1, 1000, NO_AP_FOUND, -90, false);
  log.record(1, 2000, AUTH_FAIL, -60, false);
  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 2);

  // Recorded while the peeked events are being reported
  log.record(1, 3000, BEACON_TIMEOUT, -70, true);
  log.discard(2);

  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);
  EXPECT_EQ(out[0].reason, BEACON_TIMEOUT);
  EXPECT_EQ(out[0].uptimeMs, 3000);
}

TEST_F(WifiDisconnectLogTest, DiscardClampsToSize) {
  WifiDisconnectLog log{storage};
  log.record(1, 1000, NO_AP_FOUND, -90, false);
  log.discard(5);
  EXPECT_EQ(log.size(), 0);

  // A new identical event starts a new entry
  log.record(1, 2000, NO_AP_FOUND, -90, false);
  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);
  EXPECT_EQ(out[0].count, 1);
}

TEST_F(WifiDisconnectLogTest, PersistsAcrossInstances) {
  {
    WifiDisconnectLog log{storage};
    log.record(1, 1000, NO_AP_FOUND, -90, false);
  }

  // New WifiDisconnectLog instance with old storage
  WifiDisconnectLog log{storage};
  ASSERT_EQ(log.peek(out, WifiDisconnectLog::CAPACITY), 1);
  EXPECT_EQ(out[0].reason, NO_AP_FOUND);
}

TEST_F(WifiDisconnectLogTest, ResetsOnBadMagic) {
  memset(&storage, 0xA5, sizeof(storage));
  storage.size = 1;
  WifiDisconnectLog log{storage};
  EXPECT_EQ(log.size(), 0);
}

TEST_F(WifiDisconnectLogTest, ResetsOnOutOfRangeSize) {
  {
    WifiDisconnectLog log{storage};
    log.record(1, 1000, NO_AP_FOUND, -90, false);
  }
  storage.size = WifiDisconnectLog::CAPACITY + 1;

  WifiDisconnectLog log{storage};
  EXPECT_EQ(log.size(), 0u);
}
