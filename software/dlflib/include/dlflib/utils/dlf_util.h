#pragma once

#include <Arduino.h>

// https://stackoverflow.com/a/59522794/16238567
inline constexpr size_t hash_str(const char* s, int off = 0) {
  return !s[off] ? 5381 : (hash_str(s, off + 1) * 33) ^ s[off];
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
inline constexpr const char* characteristic_type_name() {
  return t<T>();
}

template <typename T>
inline constexpr size_t hash_type() {
  return hash_str(t<T>());
}

/**
 * Joins multiple path segments into a normalized path
 */
inline String resolvePath(std::initializer_list<String> parts) {
  String result = "";

  for (const String& part : parts) {
    if (part.length() == 0) continue;

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