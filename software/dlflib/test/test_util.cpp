#include <gtest/gtest.h>

#include "dlflib/util/util.h"

using namespace dlf::util;

TEST(CopyRange, HappyPath) {
  char dst[16];
  const char* src = "hello";
  EXPECT_TRUE(copyRange(dst, sizeof(dst), src, src + 5));
  EXPECT_STREQ(dst, "hello");
}

TEST(CopyRange, ExactFit) {
  char dst[6];
  const char* src = "hello";
  EXPECT_TRUE(copyRange(dst, sizeof(dst), src, src + 5));
  EXPECT_STREQ(dst, "hello");
}

TEST(CopyRange, TruncatesToDst) {
  char dst[4];
  const char* src = "hello";
  EXPECT_TRUE(copyRange(dst, sizeof(dst), src, src + 5));
  EXPECT_STREQ(dst, "hel");
}

TEST(CopyRange, EmptyRange) {
  char dst[9] = "existing";
  const char* src = "hello";
  EXPECT_TRUE(copyRange(dst, sizeof(dst), src, src));
  EXPECT_STREQ(dst, "");
}

TEST(CopyRange, NullDst) {
  const char* src = "hello";
  EXPECT_FALSE(copyRange(nullptr, 8, src, src + 5));
}

TEST(CopyRange, ZeroDstSize) {
  char dst[8];
  const char* src = "hello";
  EXPECT_FALSE(copyRange(dst, 0, src, src + 5));
}

TEST(CopyRange, NullBegin) {
  char dst[8];
  EXPECT_FALSE(copyRange(dst, sizeof(dst), nullptr, nullptr));
}

TEST(CopyRange, EndBeforeBegin) {
  char dst[8];
  const char* src = "hello";
  EXPECT_FALSE(copyRange(dst, sizeof(dst), src + 3, src));
}

TEST(ParseU16, ParsesZero) {
  const char* s = "0";
  uint16_t out = 999;
  EXPECT_TRUE(parseU16(s, s + 1, out));
  EXPECT_EQ(out, 0);
}

TEST(ParseU16, ParsesMaxValue) {
  const char* s = "65535";
  uint16_t out = 0;
  EXPECT_TRUE(parseU16(s, s + 5, out));
  EXPECT_EQ(out, 65535);
}

TEST(ParseU16, OverflowFails) {
  const char* s = "65536";
  uint16_t out = 0;
  EXPECT_FALSE(parseU16(s, s + 5, out));
}

TEST(ParseU16, NonDigitCharFails) {
  const char* s = "80ab";
  uint16_t out = 0;
  EXPECT_FALSE(parseU16(s, s + 4, out));
}

TEST(ParseU16, EmptyRangeFails) {
  const char* s = "80";
  uint16_t out = 0;
  EXPECT_FALSE(parseU16(s, s, out));
}

TEST(ParseU16, NullPointerFails) {
  uint16_t out = 0;
  EXPECT_FALSE(parseU16(nullptr, nullptr, out));
}

TEST(JoinPath, NeitherHasSlash) {
  char out[32];
  EXPECT_TRUE(joinPath(out, sizeof(out), "api", "upload"));
  EXPECT_STREQ(out, "api/upload");
}

TEST(JoinPath, OnlyAEndsWithSlash) {
  char out[32];
  EXPECT_TRUE(joinPath(out, sizeof(out), "api/", "upload"));
  EXPECT_STREQ(out, "api/upload");
}

TEST(JoinPath, OnlyBStartsWithSlash) {
  char out[32];
  EXPECT_TRUE(joinPath(out, sizeof(out), "api", "/upload"));
  EXPECT_STREQ(out, "api/upload");
}

TEST(JoinPath, BothHaveSlash) {
  char out[32];
  EXPECT_TRUE(joinPath(out, sizeof(out), "api/", "/upload"));
  EXPECT_STREQ(out, "api/upload");
}

TEST(JoinPath, EmptyFirstComponent) {
  char out[32];
  EXPECT_TRUE(joinPath(out, sizeof(out), "", "upload"));
  EXPECT_STREQ(out, "/upload");
}

TEST(JoinPath, NullOutputFails) {
  EXPECT_FALSE(joinPath(nullptr, 32, "a", "b"));
}

TEST(JoinPath, NullInputFails) {
  char out[32];
  EXPECT_FALSE(joinPath(out, sizeof(out), nullptr, "b"));
  EXPECT_FALSE(joinPath(out, sizeof(out), "a", nullptr));
}

TEST(ParseUrl, FullHttpsUrl) {
  auto p = parseUrl("https://api.example.com/api/upload");
  EXPECT_TRUE(p.ok);
  EXPECT_STREQ(p.scheme, "https");
  EXPECT_STREQ(p.host, "api.example.com");
  EXPECT_EQ(p.port, 443);
  EXPECT_STREQ(p.path, "/api/upload");
}

TEST(ParseUrl, FullHttpUrlWithExplicitPort) {
  auto p = parseUrl("http://host:8080/path/to/resource");
  EXPECT_TRUE(p.ok);
  EXPECT_STREQ(p.scheme, "http");
  EXPECT_STREQ(p.host, "host");
  EXPECT_EQ(p.port, 8080);
  EXPECT_STREQ(p.path, "/path/to/resource");
}

TEST(ParseUrl, DefaultHttpPort) {
  auto p = parseUrl("http://example.com/page");
  EXPECT_TRUE(p.ok);
  EXPECT_EQ(p.port, 80);
}

TEST(ParseUrl, ExplicitDefaultPort) {
  auto p = parseUrl("https://example.com:443/page");
  EXPECT_TRUE(p.ok);
  EXPECT_EQ(p.port, 443);
}

TEST(ParseUrl, NoPathDefaultsToSlash) {
  auto p = parseUrl("https://example.com");
  EXPECT_TRUE(p.ok);
  EXPECT_STREQ(p.host, "example.com");
  EXPECT_STREQ(p.path, "/");
}

TEST(ParseUrl, TrailingSlashOnlyPath) {
  auto p = parseUrl("https://example.com/");
  EXPECT_TRUE(p.ok);
  EXPECT_STREQ(p.path, "/");
}

TEST(ParseUrl, NoSchemeFails) {
  auto p = parseUrl("example.com/path");
  EXPECT_FALSE(p.ok);
}

TEST(ParseUrl, NullPointerFails) {
  auto p = parseUrl(nullptr);
  EXPECT_FALSE(p.ok);
}

TEST(ParseUrl, InvalidPortFails) {
  auto p = parseUrl("https://host:notaport/path");
  EXPECT_FALSE(p.ok);
}

TEST(ParseUrl, PortOverflowFails) {
  auto p = parseUrl("https://host:99999/path");
  EXPECT_FALSE(p.ok);
}

TEST(ParseUrl, HostWithColonButNoPort) {
  auto p = parseUrl("https://host:/path");
  EXPECT_FALSE(p.ok);
}

int main(int argc, char** argv) {
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}