#pragma once

#include <cstdint>
#include <cstring>

namespace ota::util {

inline bool bytesToHexLower(const uint8_t* bytes, size_t len, char* out,
                            size_t outSize) {
  static constexpr char HEX_MAP[]{"0123456789abcdef"};

  if (!bytes || !out || outSize < (len * 2 + 1)) {
    return false;
  }

  for (size_t i = 0; i < len; ++i) {
    out[i * 2] = HEX_MAP[(bytes[i] >> 4) & 0x0F];
    out[i * 2 + 1] = HEX_MAP[bytes[i] & 0x0F];
  }
  out[len * 2] = '\0';
  return true;
}

inline bool copyStr(char* dst, size_t dstSize, const char* src) {
  if (!dst || dstSize == 0) {
    return false;
  }

  if (!src) {
    dst[0] = '\0';
    return true;
  }

  const size_t srcLen{strlen(src)};
  if (srcLen >= dstSize) {
    dst[0] = '\0';
    return false;
  }

  memcpy(dst, src, srcLen + 1);
  return true;
}

inline bool hexEqualsIgnoreCase(const char* a, const char* b) {
  if (!a || !b) {
    return false;
  }

  while (*a && *b) {
    char ca{*a};
    char cb{*b};

    if (ca >= 'A' && ca <= 'Z') {
      ca = static_cast<char>(ca - 'A' + 'a');
    }
    if (cb >= 'A' && cb <= 'Z') {
      cb = static_cast<char>(cb - 'A' + 'a');
    }

    if (ca != cb) {
      return false;
    }
    ++a;
    ++b;
  }

  return *a == '\0' && *b == '\0';
}

}  // namespace ota::util
