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
 protected:
  /**
   * @brief Data stream handles logged by this logfile
   */
  dlf::datastream::stream_handles_t _handles;

  fs::FS& _fs;
  String _filename;
  fs::File _f;

  /**
   * @brief Streambuffer responsible for transferring data from sampler task to
   * SD writer task
   */
  StreamBufferHandle_t _stream;
  dlf_file_state_e _state;
  SemaphoreHandle_t _sync;
  SemaphoreHandle_t
      _file_mutex;  // Protects file operations from race conditions
  dlf_tick_t _last_tick;
  size_t _file_end_position;  // Track file end position to prevent truncation
                              // on close

  /**
   * @brief Writes a complete header into this logfile.
   *
   * Uses existing streambuffer architecture because why not.
   */
  void _write_header(dlf_stream_type_e stream_type);

  /**
   * Updates and closes the underlying file. Does not flush internal
   * buffers
   */
  void _close_file();

  /**
   * @brief Task responsible for writing data to SD
   * Constantly receives data from _stream streambuffer and writes to SD.
   * @param arg
   */
  static void task_flusher(void* arg);

  void flush();

 public:
  LogFile(dlf::datastream::stream_handles_t handles,
          dlf_stream_type_e stream_type, String dir, fs::FS& fs);

  /**
   * Samples data. Intended to be externally called at the tick interval.
   * Called by the Run class to trigger a sample.
   */
  void sample(dlf_tick_t tick);

  /**
   * Flushes and closes this logfile
   */
  void close();
};

}  // namespace dlf