#include <gtest/gtest.h>

#include "ota_updater/util.h"

using namespace ota::util;

TEST(BytesToHexLower, KnownBytes) {
  const uint8_t bytes[] = {0xDE, 0xAD, 0xBE, 0xEF};
  char out[9];
  EXPECT_TRUE(bytesToHexLower(bytes, sizeof(bytes), out, sizeof(out)));
  EXPECT_STREQ(out, "deadbeef");
}

TEST(BytesToHexLower, NullBytesFails) {
  char out[9];
  EXPECT_FALSE(bytesToHexLower(nullptr, 4, out, sizeof(out)));
}

TEST(BytesToHexLower, NullOutFails) {
  const uint8_t bytes[] = {0x01};
  EXPECT_FALSE(bytesToHexLower(bytes, 1, nullptr, 3));
}

TEST(BytesToHexLower, OutBufferTooSmall) {
  const uint8_t bytes[] = {0xAB, 0xCD};
  char out[4];  // needs 5 (4 hex chars + null), only 4 available
  EXPECT_FALSE(bytesToHexLower(bytes, sizeof(bytes), out, sizeof(out)));
}

TEST(BytesToHexLower, ExactSizeBuffer) {
  const uint8_t bytes[] = {0x0F};
  char out[3];  // exactly 2 hex + null
  EXPECT_TRUE(bytesToHexLower(bytes, sizeof(bytes), out, sizeof(out)));
  EXPECT_STREQ(out, "0f");
}

TEST(BytesToHexLower, ZeroLength) {
  char out[4] = "old";
  EXPECT_TRUE(bytesToHexLower(reinterpret_cast<const uint8_t*>("x"), 0, out,
                              sizeof(out)));
  EXPECT_STREQ(out, "");
}

TEST(CopyStr, HappyPath) {
  char dst[16];
  EXPECT_TRUE(copyStr(dst, sizeof(dst), "hello"));
  EXPECT_STREQ(dst, "hello");
}

TEST(CopyStr, ExactFit) {
  char dst[6];  // 5 chars + null
  EXPECT_TRUE(copyStr(dst, sizeof(dst), "hello"));
  EXPECT_STREQ(dst, "hello");
}

TEST(CopyStr, TooLongFails) {
  char dst[4];  // can hold 3 chars + null, "hello" won't fit
  EXPECT_FALSE(copyStr(dst, sizeof(dst), "hello"));
  EXPECT_STREQ(dst, "");  // dst cleared on failure
}

TEST(CopyStr, NullSrcSetsEmpty) {
  char dst[8] = "old";
  EXPECT_TRUE(copyStr(dst, sizeof(dst), nullptr));
  EXPECT_STREQ(dst, "");
}

TEST(CopyStr, NullDstFails) { EXPECT_FALSE(copyStr(nullptr, 8, "hello")); }

TEST(CopyStr, ZeroDstSizeFails) {
  char dst[8];
  EXPECT_FALSE(copyStr(dst, 0, "hello"));
}

TEST(CopyStr, EmptyString) {
  char dst[8] = "old";
  EXPECT_TRUE(copyStr(dst, sizeof(dst), ""));
  EXPECT_STREQ(dst, "");
}

TEST(HexEqualsIgnoreCase, EqualLowercase) {
  EXPECT_TRUE(hexEqualsIgnoreCase("deadbeef", "deadbeef"));
}

TEST(HexEqualsIgnoreCase, EqualMixedCase) {
  EXPECT_TRUE(hexEqualsIgnoreCase("DEADBEEF", "deadbeef"));
}

TEST(HexEqualsIgnoreCase, EqualUppercase) {
  EXPECT_TRUE(hexEqualsIgnoreCase("DEADBEEF", "DEADBEEF"));
}

TEST(HexEqualsIgnoreCase, EqualMixedBothSides) {
  EXPECT_TRUE(hexEqualsIgnoreCase("DeAdBeEf", "dEaDbEeF"));
}

TEST(HexEqualsIgnoreCase, NotEqual) {
  EXPECT_FALSE(hexEqualsIgnoreCase("deadbeef", "deadbeee"));
}

TEST(HexEqualsIgnoreCase, DifferentLengths) {
  EXPECT_FALSE(hexEqualsIgnoreCase("deadbeef", "deadbee"));
  EXPECT_FALSE(hexEqualsIgnoreCase("deadbee", "deadbeef"));
}

TEST(HexEqualsIgnoreCase, EmptyStringsEqual) {
  EXPECT_TRUE(hexEqualsIgnoreCase("", ""));
}

TEST(HexEqualsIgnoreCase, OneEmptyOneFull) {
  EXPECT_FALSE(hexEqualsIgnoreCase("", "ab"));
  EXPECT_FALSE(hexEqualsIgnoreCase("ab", ""));
}

TEST(HexEqualsIgnoreCase, NullAFails) {
  EXPECT_FALSE(hexEqualsIgnoreCase(nullptr, "deadbeef"));
}

TEST(HexEqualsIgnoreCase, NullBFails) {
  EXPECT_FALSE(hexEqualsIgnoreCase("deadbeef", nullptr));
}

TEST(HexEqualsIgnoreCase, BothNullFails) {
  EXPECT_FALSE(hexEqualsIgnoreCase(nullptr, nullptr));
}

int main(int argc, char** argv) {
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}