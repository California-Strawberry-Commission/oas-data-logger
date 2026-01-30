#pragma once

#include <Arduino.h>

/**
 * @namespace ezlog
 *
 * A lightweight, thread-safe logger for ESP32 Arduino using FreeRTOS.
 *
 * DESIGN GOALS
 * ------------
 * - Safe to call from multiple tasks (uses a queue + writer task)
 * - Very low overhead in caller tasks and minimal usage of caller stack
 * - Supports Serial and LittleFS sinks
 * - Periodic and severity-based flushing for flash safety
 * - Log rotation to prevent LittleFS from filling
 * - No dynamic allocation during normal logging
 *
 * USAGE
 * -----
 * In setup():
 *
 *   ezlog::addSerial(ezlog::Level::INFO);
 *   ezlog::addLittleFS(ezlog::Level::INFO);
 *
 * Then anywhere:
 *
 *   EZLOG_INFO("Hello world %d", 42);
 *
 */

namespace ezlog {

enum class Level : uint8_t { DEBUG, INFO, WARN, ERROR };

struct EntryHeader {
  uint32_t ms;
  Level level;
};

/* ========================= CONFIGURATION ========================= */

/**
 * Configure queue depth and maximum formatted message length.
 *
 * Must be called before addSerial/addLittleFS.
 *
 * @param queueDepth Number of log entries buffered in the queue.
 * @param maxMessageLen Maximum characters per formatted log message.
 */
void setQueueConfig(uint16_t queueDepth, uint16_t maxMessageLen);

/**
 * Configure the FreeRTOS writer task.
 *
 * Must be called before addSerial/addLittleFS.
 *
 * @param stackWords Stack size in 32-bit words (not bytes).
 * @param priority FreeRTOS task priority.
 * @param core Core to pin to (-1 = no pin).
 */
void setTaskConfig(uint32_t stackWords, UBaseType_t priority,
                   BaseType_t core = -1);

/**
 * Configure log rotation.
 *
 * When the current log file exceeds maxBytes, files are rotated:
 *   log.txt -> log.1.txt -> log.2.txt ...
 *
 * @param maxBytes Maximum size of the active log file before rotation.
 * @param fileCount Total number of rotated files to keep (>= 2).
 */
void setRotation(size_t maxBytes, uint8_t fileCount);

/**
 * Configure LittleFS flush behavior.
 *
 * @param flushEveryMs Periodic flush interval.
 * @param flushImmediateLevel Flush immediately for logs >= this level.
 */
void setLittleFSFlushPolicy(uint32_t flushEveryMs,
                            Level flushImmediateLevel = Level::ERROR);

/* ========================= SINK SETUP ========================= */

/**
 * Enable logging to Serial.
 *
 * @param minLevel Minimum log level to print to Serial.
 */
bool addSerial(Level minLevel = Level::INFO);

/**
 * Enable logging to LittleFS.
 * This mounts LittleFS and opens the log file in append mode.
 *
 * @param minLevel Minimum log level to write to file.
 * @param path Path of the log file (e.g. "/ezlog.txt").
 * @param formatOnFail Whether to format LittleFS if mount fails.
 */
bool addLittleFS(Level minLevel = Level::INFO, const char* path = "/ezlog.txt",
                 bool formatOnFail = true);

/* ========================= LOGGING API ========================= */

/**
 * Log a printf-style message.
 *
 * Thread-safe. Formats the message and enqueues it for the writer task.
 *
 * @param level  Log severity.
 * @param fmt    printf-style format string.
 * @param ...    Format arguments.
 */
void logf(Level level, const char* fmt, ...)
    __attribute__((format(printf, 2, 3)));

/**
 * Internal version of logf that accepts a va_list.
 */
void logv(Level level, const char* fmt, va_list ap);

}  // namespace ezlog

// Convenience macros
#define EZLOG_DEBUG(fmt, ...) \
  ::ezlog::logf(::ezlog::Level::DEBUG, (fmt), ##__VA_ARGS__)
#define EZLOG_INFO(fmt, ...) \
  ::ezlog::logf(::ezlog::Level::INFO, (fmt), ##__VA_ARGS__)
#define EZLOG_WARN(fmt, ...) \
  ::ezlog::logf(::ezlog::Level::WARN, (fmt), ##__VA_ARGS__)
#define EZLOG_ERROR(fmt, ...) \
  ::ezlog::logf(::ezlog::Level::ERROR, (fmt), ##__VA_ARGS__)
