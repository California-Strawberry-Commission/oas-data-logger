#pragma once

#ifdef DLFLIB_USE_ADVANCED_LOGGER

#include <AdvancedLogger.h>

#define DLFLIB_LOG_ERROR(fmt, ...) LOG_ERROR(fmt, ##__VA_ARGS__)

#define DLFLIB_LOG_WARNING(fmt, ...) LOG_WARNING(fmt, ##__VA_ARGS__)

#define DLFLIB_LOG_INFO(fmt, ...) LOG_INFO(fmt, ##__VA_ARGS__)

#define DLFLIB_LOG_DEBUG(fmt, ...) LOG_DEBUG(fmt, ##__VA_ARGS__)

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