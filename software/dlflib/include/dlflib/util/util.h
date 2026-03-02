#pragma once

#include <Arduino.h>

#include <memory>

namespace dlf::util {

template <typename T, typename... Args>
std::unique_ptr<T> make_unique(Args&&... args) {
  return std::unique_ptr<T>(new T(std::forward<Args>(args)...));
}

// https://stackoverflow.com/a/59522794/16238567
inline constexpr size_t hashStr(const char* s, int off = 0) {
  return !s[off] ? 5381 : (hashStr(s, off + 1) * 33) ^ s[off];
}

template <typename T>
inline constexpr const char* t() {
#ifdef _MSC_VER
  return __FUNCSIG__;
#else
  return __PRETTY_FUNCTION__;
#endif
}

/**
 * Generates a characteristic type name for the passed
 * type using GCC's __PRETTY_FUNCTION__
 * This string should be parsable to get the actual type's name.
 */
template <typename T>
inline constexpr const char* characteristicTypeName() {
  return t<T>();
}

template <typename T>
inline constexpr size_t hashType() {
  return hashStr(t<T>());
}

/**
 * Joins multiple path segments into a normalized path
 */
inline String resolvePath(std::initializer_list<String> parts) {
  String result = "";

  for (const String& part : parts) {
    if (part.length() == 0) {
      continue;
    }

    if (result.endsWith("/") && part.startsWith("/")) {
      result += part.substring(1);
    } else if (!result.endsWith("/") && !part.startsWith("/")) {
      result += "/" + part;
    } else {
      result += part;
    }
  }

  return result.length() == 0 ? "/" : result;
}

/**
 * Copies characters from [begin, end) into `dst`, truncating if necessary to
 * fit in `dstSize - 1` bytes, and null-terminates it.
 *
 * @param dst Destination buffer.
 * @param dstSize Size of destination buffer in bytes.
 * @param begin Pointer to start of source range (inclusive).
 * @param end Pointer to end of source range (exclusive).
 * @return true on success, false if parameters are invalid.
 */
inline bool copyRange(char* dst, size_t dstSize, const char* begin,
                      const char* end) {
  if (!dst || dstSize == 0 || !begin || !end || end < begin) {
    return false;
  }
  size_t n = static_cast<size_t>(end - begin);
  if (n >= dstSize) {
    n = dstSize - 1;
  }
  memcpy(dst, begin, n);
  dst[n] = '\0';
  return true;
}

/**
 * Parses a decimal integer from the range [begin, end).
 *
 * @param begin Pointer to first digit.
 * @param end Pointer one past the last digit.
 * @param[out] out Parsed value on success
 * @return true if parsing succeeded, false otherwise
 */
inline bool parseU16(const char* begin, const char* end, uint16_t& out) {
  if (!begin || !end || end <= begin) {
    return false;
  }

  uint32_t value = 0;
  for (const char* p = begin; p < end; ++p) {
    if (*p < '0' || *p > '9') {
      // Failed to parse - non-digit char found
      return false;
    }
    value = value * 10 + static_cast<uint32_t>(*p - '0');
    if (value > 65535) {
      // Failed to parse - overflow
      return false;
    }
  }

  out = static_cast<uint16_t>(value);
  return true;
}

/**
 * Joins two path components with exactly one '/' separator.
 *
 * @param out Destination buffer.
 * @param outSize Size of destination buffer.
 * @param a First path component.
 * @param b Second path component.
 * @return true if the resulting path fits in the buffer.
 */
inline bool joinPath(char* out, size_t outSize, const char* a, const char* b) {
  if (!out || outSize == 0 || !a || !b) {
    return false;
  }

  const size_t aLen = strlen(a);
  const bool aEndsSlash = (aLen > 0 && a[aLen - 1] == '/');
  const bool bStartsSlash = (b[0] == '/');

  if (aEndsSlash && bStartsSlash) {
    return snprintf(out, outSize, "%s%s", a, b + 1) > 0;
  } else if (!aEndsSlash && !bStartsSlash) {
    return snprintf(out, outSize, "%s/%s", a, b) > 0;
  } else {
    return snprintf(out, outSize, "%s%s", a, b) > 0;
  }
}

struct UrlParts {
  char scheme[8];
  char host[128];
  uint16_t port;
  char path[128];
  bool ok;  // true if parsing succeeded
};

/**
 * Parses a URL into its components.
 *
 * Supported formats:
 *   - scheme://host/path
 *   - scheme://host:port/path
 *
 * On failure, the returned UrlParts will have `ok == false`.
 *
 * @param url Null-terminated URL string.
 * @return Parsed UrlParts structure.
 */
UrlParts parseUrl(const char* url);

}  // namespace dlf::util