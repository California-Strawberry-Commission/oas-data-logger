#pragma once

#if defined(DLFLIB_USE_ELOG) && DLFLIB_USE_ELOG

#include <Elog.h>

#ifndef DLFLIB_ELOG_ID
#define DLFLIB_ELOG_ID 42
#endif

#define DLFLIB_LOG_ERROR(fmt, ...)                                      \
  do {                                                                  \
    Logger.log(DLFLIB_ELOG_ID, ELOG_LEVEL_ERROR, (fmt), ##__VA_ARGS__); \
  } while (0)

#define DLFLIB_LOG_WARNING(fmt, ...)                                      \
  do {                                                                    \
    Logger.log(DLFLIB_ELOG_ID, ELOG_LEVEL_WARNING, (fmt), ##__VA_ARGS__); \
  } while (0)

#define DLFLIB_LOG_INFO(fmt, ...)                                      \
  do {                                                                 \
    Logger.log(DLFLIB_ELOG_ID, ELOG_LEVEL_INFO, (fmt), ##__VA_ARGS__); \
  } while (0)

#define DLFLIB_LOG_DEBUG(fmt, ...)                                      \
  do {                                                                  \
    Logger.log(DLFLIB_ELOG_ID, ELOG_LEVEL_DEBUG, (fmt), ##__VA_ARGS__); \
  } while (0)

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