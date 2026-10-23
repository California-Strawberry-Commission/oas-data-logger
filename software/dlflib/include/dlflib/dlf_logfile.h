#pragma once

#include <Arduino.h>
#include <FS.h>
#include <freertos/stream_buffer.h>

#include <functional>
#include <vector>

#include "dlflib/datastream/abstract_stream_handle.h"
#include "dlflib/dlf_types.h"

namespace dlf {

/**
 * A file write issue encountered while writing a logfile.
 */
struct FileWriteIssue {
  enum class Type : uint8_t {
    // A write failed, but succeeded on a retry.
    RECOVERED = 0,
    // A write kept failing until the retry timeout, so all further writes to
    // the file were abandoned. The file is truncated.
    ABANDONED = 1,
    // After reopening, the file size did not match the bytes written, meaning
    // data was lost when closing.
    SIZE_MISMATCH = 2,
  };

  Type type;
  dlf_stream_type_e streamType;
  uint32_t offset;      // offset of the failed write
  uint32_t attempts;    // failed attempts (0 for SIZE_MISMATCH)
  uint32_t uptimeMs;    // millis() at the first failure
  uint32_t durationMs;  // duration from the first failure until recovered or
                        // abandoned
};

using FileWriteIssueHandler = std::function<void(const FileWriteIssue& issue)>;

/**
 * Sets the handler called whenever a logfile write issue occurs. The handler
 * is called from the logfile's flusher task, so it must not block.
 *
 * Must be set before starting any run, since it is not synchronized with the
 * flusher tasks that call it.
 *
 * @param handler Handler to call, or an empty function for none.
 */
void setFileWriteIssueHandler(FileWriteIssueHandler handler);

/**
 * @brief Handles logging of datastreams to files.
 *
 * Handles a SINGLE TYPE of datastream handle (IE polled/event).
 * All data sampled by a LogFile class is written into a single contiguous file.
 * Sampled data is written into chunks that are then pushed to the provided
 * queue. The provided queue should write the passed chunks to the specified
 * pointer.
 *
 * LogFiles do NOT create tasks themselves. All RTOS task creation is handled by
 * the Run class (which manages multiple LogFile instances)
 *
 * https://stackoverflow.com/questions/8915873/how-much-work-should-constructor-of-my-class-perform
 */
class LogFile {
 public:
  LogFile(std::vector<std::unique_ptr<dlf::datastream::AbstractStreamHandle>>
              handles,
          dlf_stream_type_e streamType, const char* dir, fs::FS& fs);

  /**
   * Samples data. Intended to be externally called at the tick interval.
   * Called by the Run class to trigger a sample.
   * @param tick The tick to sample data at
   */
  void sample(dlf_tick_t tick);

  /**
   * Flushes and closes this logfile.
   */
  void close();

  /**
   * Force a manual flush on the logfile.
   */
  void flush();

  /**
   * Lock the file mutex
   */
  void lock();

  /**
   * Release the file mutex
   */
  void unlock();

 private:
  /**
   * @brief Task responsible for writing data to SD
   * Constantly receives data from _stream streambuffer and writes to SD.
   * @param arg
   */
  static void taskFlusher(void* arg);

  /**
   * Reopens the file in "r+" mode, positioned at the end of the data written
   * so far. Called from the flusher task.
   * @return true if the file was reopened
   */
  bool reopen();

  /**
   * Attempts to reopen the file, with backoff. Called from the flusher task.
   * @param timeoutMs A zero timeoutMs will keep retrying indefinitely until
   * successful, or state is no longer LOGGING.
   * @return true if the file was reopened
   */
  bool reopenWithRetry(uint32_t timeoutMs);

  /**
   * Writes a chunk at the end of the data written so far, retrying until the
   * write is verified or timeoutMs elapses. If it fails, all further writes are
   * abandoned. Must be called from the flusher task with fileMutex_ held.
   * @return true if the chunk was written
   */
  bool writeChunk(const uint8_t* data, size_t len, uint32_t timeoutMs);

  /**
   * @brief Writes a complete header into this logfile.
   *
   * Uses existing streambuffer architecture because why not.
   */
  void writeHeader(dlf_stream_type_e streamType);

  /**
   * Reports a write issue to the handler set with setFileWriteIssueHandler(),
   * if any.
   */
  void reportWriteIssue(FileWriteIssue::Type type, uint32_t attempts,
                        uint32_t uptimeMs, uint32_t durationMs);

  /**
   * Updates and closes the underlying file. Does not flush internal
   * buffers
   */
  void closeFile();

  /**
   * @brief Data stream handles logged by this logfile
   */
  std::vector<std::unique_ptr<dlf::datastream::AbstractStreamHandle>> handles_;

  fs::FS& fs_;
  dlf_stream_type_e streamType_;
  char filename_[128];
  fs::File file_;

  /**
   * @brief Streambuffer responsible for transferring data from sampler task to
   * file writer task
   */
  StreamBufferHandle_t stream_;
  dlf_file_state_e state_;
  SemaphoreHandle_t syncSemaphore_;
  SemaphoreHandle_t
      fileMutex_;  // Protects file operations from race conditions
  dlf_tick_t lastTick_;
  size_t fileEndPosition_;  // Track file end position to prevent truncation
                            // on close. Also the offset of the next write.

  // Set once a chunk could not be written within its retry timeout. All
  // subsequent data is discarded so that the file is truncated at the last
  // good byte.
  bool writesAbandoned_;
};

}  // namespace dlf