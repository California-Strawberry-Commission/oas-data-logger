#include "EzLog.h"

#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

namespace ezlog {

#pragma region Static state

/////////
// Config
/////////
static uint16_t g_queueDepth{64};
static uint16_t g_maxMsgLen{192};
static uint32_t g_taskStackWords{4096};
static UBaseType_t g_taskPriority{1};
static BaseType_t g_taskCore{-1};
static uint32_t g_lfsFlushEveryMs{5000};
static Level g_lfsFlushImmediateLevel{Level::ERROR};
// Log file rotation
static size_t g_maxLogFileBytes{512 * 1024};  // 512 KB default
static uint8_t g_logFileCount{2};             // keep current + 1 old

/////////////////////////////
// Internal handles and state
/////////////////////////////
static bool g_started{false};
static QueueHandle_t g_queue{nullptr};
static TaskHandle_t g_task{nullptr};
static volatile uint32_t g_droppedCount{0};

///////////
// Producer
///////////
// In order to avoid allocation on the caller's stack, use one shared queue-item
// buffer.
static uint8_t* g_queueItemBuf{nullptr};
static size_t g_queueItemBufSize{0};
// Locks access to the queue-item buffer
static StaticSemaphore_t g_logFmtMutexBuf;
static SemaphoreHandle_t g_logFmtMutex{nullptr};

////////
// Sinks
////////
static bool g_serialEnabled{false};
static Level g_serialMinLevel{Level::INFO};
static bool g_lfsEnabled{false};
static Level g_lfsMinLevel{Level::INFO};
static const char* g_lfsPath{"/ezlog.txt"};
static File g_lfsFile;
static bool g_lfsDirty{false};
static uint32_t g_lfsLastFlushMs{0};

#pragma endregion

#pragma region Forward declaration

static void taskFn(void* arg);

#pragma endregion

#pragma region Static helpers

static size_t entryBytes() {
  // header + message buffer (max msg length + '\0')
  return sizeof(EntryHeader) + (size_t)g_maxMsgLen + 1;
}

static const char* levelToStr(Level l) {
  switch (l) {
    case Level::DEBUG:
      return "DEBUG";
    case Level::INFO:
      return "INFO";
    case Level::WARN:
      return "WARN";
    case Level::ERROR:
      return "ERROR";
    default:
      return "INFO";
  }
}

static bool levelEnabled(Level msg, Level minLevel) {
  return (uint8_t)msg >= (uint8_t)minLevel;
}

static void internalLog(Level level, const char* fmt, ...) {
  if (!fmt) {
    return;
  }

  char buf[256];
  buf[0] = '\0';

  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);

  Serial.printf("[%lu][%s][ezlog] %s\n", millis(), levelToStr(level), buf);
}

static const char* baseName(const char* path) {
  const char* slash{strrchr(path, '/')};
  return slash ? slash + 1 : path;
}

#pragma endregion

#pragma region Public config

void setQueueConfig(uint16_t queueDepth, uint16_t maxMessageLen) {
  if (g_started) {
    return;
  }

  if (queueDepth < 1) {
    queueDepth = 1;
  }
  if (maxMessageLen < 32) {
    maxMessageLen = 32;
  }
  g_queueDepth = queueDepth;
  g_maxMsgLen = maxMessageLen;
}

void setTaskConfig(uint32_t stackWords, UBaseType_t priority, BaseType_t core) {
  if (g_started) {
    return;
  }

  if (stackWords < 2048) {
    stackWords = 2048;
  }
  g_taskStackWords = stackWords;
  g_taskPriority = priority;
  g_taskCore = core;
}

void setRotation(size_t maxBytes, uint8_t fileCount) {
  if (fileCount < 2) {
    fileCount = 2;
  }
  g_maxLogFileBytes = maxBytes;
  g_logFileCount = fileCount;
}

void setLittleFSFlushPolicy(uint32_t flushEveryMs, Level flushImmediateLevel) {
  if (flushEveryMs < 250) {
    flushEveryMs = 250;
  }
  g_lfsFlushEveryMs = flushEveryMs;
  g_lfsFlushImmediateLevel = flushImmediateLevel;
}

#pragma endregion

#pragma region Sinks

static void ensureStarted() {
  if (g_started) {
    return;
  }

  const size_t itemSize{entryBytes()};
  g_queue = xQueueCreate(g_queueDepth, itemSize);
  if (!g_queue) {
    // If the queue was not created, we cannot do async logging
    internalLog(Level::ERROR, "Failed to create queue");
    return;
  }

  // Create log format mutex and allocate shared queue item buffer
  g_logFmtMutex = xSemaphoreCreateMutexStatic(&g_logFmtMutexBuf);
  g_queueItemBufSize = itemSize;
  g_queueItemBuf = (uint8_t*)malloc(itemSize);
  if (!g_queueItemBuf) {
    internalLog(Level::ERROR, "Failed to allocate queue item buffer");
    return;
  }

  // Create writer task
  if (g_taskCore >= 0) {
    xTaskCreatePinnedToCore(taskFn, "ezlog_task", g_taskStackWords, nullptr,
                            g_taskPriority, &g_task, g_taskCore);
  } else {
    xTaskCreate(taskFn, "ezlog_task", g_taskStackWords, nullptr, g_taskPriority,
                &g_task);
  }
  if (!g_task) {
    // If the task was not created, we cannot do async logging
    internalLog(Level::ERROR, "Failed to create task");
    return;
  }

  g_lfsLastFlushMs = millis();
  g_started = true;
}

bool addSerial(Level minLevel) {
  ensureStarted();
  g_serialEnabled = true;
  g_serialMinLevel = minLevel;
  return true;
}

bool addLittleFS(Level minLevel, const char* path, bool formatOnFail) {
  ensureStarted();

  if (!path || path[0] == '\0') {
    path = "/ezlog.txt";
  }
  g_lfsPath = path;

  // Mount LittleFS
  if (!LittleFS.begin(formatOnFail)) {
    internalLog(Level::ERROR, "LittleFS.begin() failed");
    g_lfsEnabled = false;
    return false;
  }

  // Open log file in append mode, and keep open
  g_lfsFile = LittleFS.open(g_lfsPath, FILE_APPEND);
  if (!g_lfsFile) {
    internalLog(Level::ERROR, "Failed to open log file for append");
    g_lfsEnabled = false;
    return false;
  }

  g_lfsEnabled = true;
  g_lfsMinLevel = minLevel;
  return true;
}

#pragma endregion

#pragma region Logging API

void logf(Level level, const char* file, const char* func, uint16_t line,
          const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  logv(level, file, func, line, fmt, ap);
  va_end(ap);
}

void logv(Level level, const char* file, const char* func, uint16_t line,
          const char* fmt, va_list ap) {
  ensureStarted();
  if (!g_queue || !g_logFmtMutex || !g_queueItemBuf) {
    return;
  }

  // Short circuit if this message won't be logged to any sinks
  const bool needSerial{g_serialEnabled &&
                        levelEnabled(level, g_serialMinLevel)};
  const bool needLfs{g_lfsEnabled && levelEnabled(level, g_lfsMinLevel)};
  if (!needSerial && !needLfs) {
    return;
  }

  if (xSemaphoreTake(g_logFmtMutex, pdMS_TO_TICKS(2)) != pdTRUE) {
    // If the mutex is contended and we can't acquire in a short amount of time,
    // drop the item
    g_droppedCount++;
    return;
  }

  // Build log entry item [EntryHeader][msg bytes...] into g_queueItemBuf
  auto* header = reinterpret_cast<EntryHeader*>(g_queueItemBuf);
  header->ms = millis();
  header->level = level;
  header->core = xPortGetCoreID();
  header->task = pcTaskGetName(nullptr);
  header->file = file;
  header->func = func;
  header->line = line;

  char* msg = reinterpret_cast<char*>(g_queueItemBuf + sizeof(EntryHeader));
  msg[0] = '\0';

  if (!fmt) {
    fmt = "";
  }

  va_list apCopy;
  va_copy(apCopy, ap);
  vsnprintf(msg, (size_t)g_maxMsgLen + 1, fmt, apCopy);
  va_end(apCopy);

  // Enqueue item. FreeRTOS copies g_queueItemBufSize bytes into the queue. If
  // the queue is full, the item will be dropped
  if (xQueueSend(g_queue, g_queueItemBuf, 0) != pdTRUE) {
    g_droppedCount++;
  }

  xSemaphoreGive(g_logFmtMutex);
}

#pragma endregion

#pragma region Writer task

static void serialWriteLine(const EntryHeader& header, const char* msg) {
  Serial.printf("[%lu][%s][C%d][%s][%s:%u][%s] %s\n", (unsigned long)header.ms,
                levelToStr(header.level), header.core,
                header.task ? header.task : "?", baseName(header.file),
                header.line, header.func ? header.func : "?", msg);
}

static bool lfsWriteLine(const EntryHeader& header, const char* msg) {
  size_t written{g_lfsFile.printf(
      "[%lu][%s][C%d][%s][%s:%u][%s] %s\n", (unsigned long)header.ms,
      levelToStr(header.level), header.core, header.task ? header.task : "?",
      baseName(header.file), header.line, header.func ? header.func : "?",
      msg)};
  return written > 0;
}

/**
 * Build rotated filenames based on a base path:
 * base path (index 0) => "/path/name.ext"
 * index i>0           => "/path/name.i.ext"
 *
 * Examples:
 * "/ezlog.txt"   -> "/ezlog.1.txt"
 * "/logs/ez.txt" -> "/logs/ez.2.txt"
 * "/ezlog"       -> "/ezlog.1"
 */
static String makeRotatedPath(const String& base, int index) {
  if (index == 0) {
    return base;
  }

  int slash{base.lastIndexOf('/')};
  int dot{base.lastIndexOf('.')};

  // Only treat '.' as extension if it's after the last '/'
  bool hasExt{(dot > slash)};

  if (hasExt) {
    String prefix{base.substring(0, dot)};
    String ext{base.substring(dot)};
    return prefix + "." + String(index) + ext;
  } else {
    return base + "." + String(index);
  }
}

static void rotateLogsIfNeeded() {
  if (!g_lfsFile || g_lfsFile.size() < g_maxLogFileBytes) {
    return;
  }

  g_lfsFile.flush();
  g_lfsFile.close();

  // Ideally avoid String, but since rotation happens so infrequently, it's fine
  String base{g_lfsPath && g_lfsPath[0] ? g_lfsPath : "/ezlog.txt"};

  // Delete oldest log file
  String oldest{makeRotatedPath(base, g_logFileCount - 1)};
  LittleFS.remove(oldest);

  // Shift other log files
  for (int i = g_logFileCount - 2; i >= 0; --i) {
    String from{makeRotatedPath(base, i)};
    String to{makeRotatedPath(base, i + 1)};

    if (LittleFS.exists(from)) {
      LittleFS.rename(from, to);
    }
  }

  // Open new log file
  g_lfsFile = LittleFS.open(base, FILE_APPEND);
  g_lfsLastFlushMs = millis();
  g_lfsDirty = false;
}

static void reportDroppedLogs() {
  uint32_t dropped{g_droppedCount};
  if (dropped > 0) {
    g_droppedCount = 0;
    internalLog(Level::WARN, "Dropped %lu log messages",
                (unsigned long)dropped);
  }
}

static void taskFn(void*) {
  const size_t itemSize{entryBytes()};
  uint8_t* item{(uint8_t*)malloc(itemSize)};
  if (!item) {
    vTaskDelete(nullptr);
    return;
  }

  while (true) {
    // Wake periodically so we can flush on a timer even if logs stop arriving
    const TickType_t waitTicks{pdMS_TO_TICKS(250)};
    const bool received{(xQueueReceive(g_queue, item, waitTicks) == pdTRUE)};

    reportDroppedLogs();

    const uint32_t now{millis()};
    if (received) {
      const EntryHeader* header{(const EntryHeader*)item};
      const char* msg{(const char*)(item + sizeof(EntryHeader))};

      // Write to Serial
      if (g_serialEnabled && levelEnabled(header->level, g_serialMinLevel)) {
        serialWriteLine(*header, msg);
      }

      // Write to LittleFS
      if (g_lfsEnabled && g_lfsFile &&
          levelEnabled(header->level, g_lfsMinLevel)) {
        if (!lfsWriteLine(*header, msg)) {
          // If write to LittleFS fails, disable LFS sink to prevent repeated
          // failures
          g_lfsEnabled = false;
          internalLog(Level::ERROR,
                      "LittleFS write failed. Disabling LittleFS sink");
        } else {
          g_lfsDirty = true;
        }

        rotateLogsIfNeeded();

        // Immediate flush for high severity
        if ((uint8_t)header->level >= (uint8_t)g_lfsFlushImmediateLevel) {
          g_lfsFile.flush();
          g_lfsLastFlushMs = now;
          g_lfsDirty = false;
        }
      }
    }

    // Periodic flush
    if (g_lfsEnabled && g_lfsFile && g_lfsDirty &&
        (uint32_t)(now - g_lfsLastFlushMs) >= g_lfsFlushEveryMs) {
      g_lfsFile.flush();
      g_lfsLastFlushMs = now;
      g_lfsDirty = false;
    }
  }
}

#pragma endregion

}  // namespace ezlog