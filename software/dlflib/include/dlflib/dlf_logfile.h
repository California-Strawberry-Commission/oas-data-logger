#pragma once

#include <Arduino.h>
#include <FS.h>
#include <freertos/stream_buffer.h>

#include <vector>

#include "dlflib/datastream/abstract_stream_handle.h"
#include "dlflib/dlf_types.h"

namespace dlf {

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
   * Updates and closes the underlying file. Does not flush internal
   * buffers
   */
  void closeFile();

  /**
   * @brief Data stream handles logged by this logfile
   */
  std::vector<std::unique_ptr<dlf::datastream::AbstractStreamHandle>> handles_;

  fs::FS& fs_;
  char filename_[128];
  fs::File file_;

  /**
   * @brief Streambuffer responsible for transferring data from sampler task to
   * SD writer task
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