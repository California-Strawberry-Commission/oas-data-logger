#pragma once

#ifdef DLFLIB_USE_EZLOG

#include <EzLog.h>

#define DLFLIB_LOG_ERROR(fmt, ...) EZLOG_ERROR(fmt, ##__VA_ARGS__)

#define DLFLIB_LOG_WARNING(fmt, ...) EZLOG_WARN(fmt, ##__VA_ARGS__)

#define DLFLIB_LOG_INFO(fmt, ...) EZLOG_INFO(fmt, ##__VA_ARGS__)

#define DLFLIB_LOG_DEBUG(fmt, ...) EZLOG_DEBUG(fmt, ##__VA_ARGS__)

#else

#include <Arduino.h>

#define DLFLIB_LOG_ERROR(fmt, ...)       \
  do {                                   \
    Serial.printf((fmt), ##__VA_ARGS__); \
    Serial.println();                    \
  } while (0)

#define DLFLIB_LOG_WARNING(fmt, ...)     \
  do {                                   \
    Serial.printf((fmt), ##__VA_ARGS__); \
    Serial.println();                    \
  } while (0)

#define DLFLIB_LOG_INFO(fmt, ...)        \
  do {                                   \
    Serial.printf((fmt), ##__VA_ARGS__); \
    Serial.println();                    \
  } while (0)

#define DLFLIB_LOG_DEBUG(fmt, ...)       \
  do {                                   \
    Serial.printf((fmt), ##__VA_ARGS__); \
    Serial.println();                    \
  } while (0)

#endif