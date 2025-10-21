#include "dlf_logfile.hpp"

#include "datastream/EventStream.hpp"
#include "datastream/PolledStream.hpp"
#include "dlf_cfg.h"
#include "dlf_util.h"
#include "uuid.h"

using std::chrono::microseconds;

namespace dlf {
/**
 * @brief Task responsible for writing data to SD
 * Constantly receives data from _stream streambuffer and writes to SD.
 * @param arg
 */
void LogFile::task_flusher(void *arg) {
  auto self = static_cast<LogFile *>(arg);

  Serial.printf("[FLUSHER] Task started for %s\n", self->_filename.c_str());

  uint8_t buf[DLF_SD_BLOCK_WRITE_SIZE];
  size_t totalBytesWritten = 0;
  uint32_t writesSinceSync = 0;
  const uint32_t WRITES_BEFORE_SYNC = 10;  // Force SD sync every 10 writes

  while (self->_state == LOGGING) {
    size_t received = xStreamBufferReceive(self->_stream, buf, sizeof(buf),
                                           pdMS_TO_TICKS(1000));

    if (received > 0) {
      Serial.printf("[FLUSHER] %s: Received %zu bytes from buffer\n",
                    self->_filename.c_str(), received);

      // Lock file mutex before writing
      if (xSemaphoreTake(self->_file_mutex, portMAX_DELAY) == pdTRUE) {
        self->_f.write(buf, received);
        totalBytesWritten += received;
        writesSinceSync++;

        // Track the file end position for proper close
        self->_file_end_position = totalBytesWritten;

        // CRITICAL: Periodically close and reopen file to force SD card sync
        // This ensures data actually reaches the physical SD card
        if (writesSinceSync >= WRITES_BEFORE_SYNC) {
          Serial.printf("[FLUSHER] %s: Forcing SD sync (close/reopen)...\n", self->_filename.c_str());

          String fname = self->_filename;
          self->_f.flush();
          self->_f.close();

          // Reopen in append mode
          self->_f = self->_fs.open(fname, "a");
          if (!self->_f) {
            Serial.printf("[FLUSHER] ERROR: Could not reopen file after sync!\n");
          } else {
            Serial.printf("[FLUSHER] %s: SD sync complete, file reopened\n", self->_filename.c_str());
          }

          writesSinceSync = 0;
        } else {
          // Regular flush (may not reach SD card)
          self->_f.flush();
        }

        Serial.printf("[FLUSHER] %s: Wrote %zu bytes, total: %zu\n",
                      self->_filename.c_str(), received, totalBytesWritten);

        xSemaphoreGive(self->_file_mutex);
      } else {
        Serial.printf("[FLUSHER] %s: FAILED to acquire mutex!\n",
                      self->_filename.c_str());
      }
    }
  }

  /* BEGIN EXIT - NO LONGER IN LOGGING STATE */

  // If errored, exit immediately
  if (self->_state != FLUSHING) {
    Serial.printf("FLUSHER ERROR WITH %x\n", self->_state);

    vTaskDelete(NULL);
    return;
  }

  Serial.println("Flushing remaining bytes...");
  // Flush remaining bytes
  while (xStreamBufferBytesAvailable(self->_stream) > 0 &&
         self->_state == FLUSHING) {
    size_t received = xStreamBufferReceive(self->_stream, buf, sizeof(buf), 0);

    if (received > 0) {
      // Lock file mutex before writing
      if (xSemaphoreTake(self->_file_mutex, portMAX_DELAY) == pdTRUE) {
        self->_f.write(buf, received);
        totalBytesWritten += received;
        self->_file_end_position = totalBytesWritten;
        xSemaphoreGive(self->_file_mutex);
      }
    }
  }

  // CRITICAL: Final SD sync - close and reopen to force all remaining data to SD card
  // This must happen BEFORE we signal completion so _close_file doesn't run yet
  if (xSemaphoreTake(self->_file_mutex, portMAX_DELAY) == pdTRUE) {
    Serial.printf("[FLUSHER] Performing final SD sync...\n");

    String fname = self->_filename;
    self->_f.flush();
    self->_f.close();

    // Reopen in read-write mode (not append) so _close_file can use it
    self->_f = self->_fs.open(fname, "r+");
    if (self->_f) {
      // Seek to end so we know where data ends
      self->_f.seek(0, SeekEnd);
      size_t actualFileSize = self->_f.position();
      Serial.printf("[FLUSHER] Final SD sync complete. Actual file size: %zu bytes\n", actualFileSize);

      // Close it - _close_file will reopen for header update
      self->_f.close();
    } else {
      Serial.printf("[FLUSHER] ERROR: Could not reopen file for final sync verification!\n");
    }

    self->_file_end_position = totalBytesWritten;
    Serial.printf("[FLUSHER] Final flush complete. Total bytes written: %zu, file end position: %zu\n",
                  totalBytesWritten, self->_file_end_position);
    xSemaphoreGive(self->_file_mutex);
  }

  self->_state == FLUSHED;
  xSemaphoreGive(self->_sync);

  Serial.printf("Flusher exited cleanly w/ HWM %u\n",
                uxTaskGetStackHighWaterMark(NULL));
  vTaskDelete(NULL);
}

void LogFile::_write_header(dlf_stream_type_e stream_type) {
  dlf_logfile_header_t h;
  h.stream_type = stream_type;
  h.num_streams = _handles.size();
  xStreamBufferSend(_stream, &h, sizeof(h), portMAX_DELAY);

  for (auto &handle : _handles) {
    handle->encode_header_into(_stream);
  }
}

void LogFile::_close_file() {
  Serial.printf("[CLOSE_FILE] Closing file, tracked end position: %zu\n", _file_end_position);

  // Get file name for debugging
  String fname = _filename;

  // Flush and close current write handle
  _f.flush();
  _f.close();

  Serial.printf("[CLOSE_FILE] File closed, checking actual size on SD...\n");

  // Check file size on SD before header update
  File checkFile = _fs.open(fname, "r");
  if (checkFile) {
    size_t sizeBeforeUpdate = checkFile.size();
    Serial.printf("[CLOSE_FILE] File size on SD BEFORE header update: %zu bytes\n", sizeBeforeUpdate);
    checkFile.close();
  }

  // Reopen in read/write mode to update header
  _f = _fs.open(fname, "r+");
  if (!_f) {
    Serial.printf("[CLOSE_FILE] ERROR: Could not reopen file for header update!\n");
    return;
  }

  // Update header with # of ticks
  _f.seek(offsetof(dlf_logfile_header_t, tick_span));
  _f.write(reinterpret_cast<uint8_t *>(&_last_tick), sizeof(dlf_tick_t));
  _f.flush();
  _f.close();

  // Check file size after header update
  checkFile = _fs.open(fname, "r");
  if (checkFile) {
    size_t sizeAfterUpdate = checkFile.size();
    Serial.printf("[CLOSE_FILE] File size on SD AFTER header update: %zu bytes\n", sizeAfterUpdate);
    checkFile.close();
  }

  Serial.printf("[CLOSE_FILE] Header update complete\n");
}

LogFile::LogFile(stream_handles_t handles, dlf_stream_type_e stream_type,
                 String dir, FS &fs)
    : _fs(fs), _handles(std::move(handles)), _file_end_position(0) {
  _filename = dir + "/" + stream_type_to_string(stream_type) + ".dlf";

  // Set up class internals
  _stream =
      xStreamBufferCreate(DLF_LOGFILE_BUFFER_SIZE, DLF_SD_BLOCK_WRITE_SIZE);
  if (_stream == NULL) {
    _state = STREAM_CREATE_ERROR;
    return;
  }

  _sync = xSemaphoreCreateCounting(1, 0);
  if (_sync == NULL) {
    _state = SYNC_CREATE_ERROR;
    return;
  }

  _file_mutex = xSemaphoreCreateMutex();
  if (_file_mutex == NULL) {
    _state = SYNC_CREATE_ERROR;
    return;
  }

  // Open logfile
  _f = _fs.open(_filename, "w", true);

  if (!_f) {
    _state = FILE_OPEN_ERROR;
    return;
  }

  // Init data flusher
  _state = LOGGING;

  // Increased stack size from 2048 to 4096 to handle deep SD card call stack
  // (especially for _f.size() and _f.position() which trigger vfs/fatfs/sdmmc operations)
  if (xTaskCreate(task_flusher, "Flusher", 4096, this, 5, NULL) != pdTRUE) {
    _state = FLUSHER_CREATE_ERROR;
    return;
  }

  // Initialize logfile
  _write_header(stream_type);
}

/**
 * @brief Samples data. Intended to be externally called at the tick interval.
 *
 * Called by the Run class to trigger a sample.
 *
 * @param tick
 */
void LogFile::sample(dlf_tick_t tick) {
  if (_state != LOGGING) return;

  _last_tick = tick;

  // Sample all handles
  for (auto &h : _handles) {
    if (h->available(tick)) {
      size_t beforeBytes = xStreamBufferBytesAvailable(_stream);
      h->encode_into(_stream, tick);
      size_t afterBytes = xStreamBufferBytesAvailable(_stream);

      // Diagnostic: Print when data is added to stream buffer
      if (afterBytes > beforeBytes && tick % 100 == 0) {
        Serial.printf("[SAMPLE] Tick %llu: Added %zu bytes to %s buffer (total: %zu)\n",
                      tick, afterBytes - beforeBytes, _filename.c_str(), afterBytes);
      }

      if (xStreamBufferIsFull(_stream)) {
        Serial.printf("[ERROR] QUEUE_FULL for %s at tick %llu\n", _filename.c_str(), tick);
        _state = QUEUE_FULL;
      }
    }
  }
}

void LogFile::flush() {
    if (_state != LOGGING) return;

    // Wait for the stream buffer to be mostly empty
    // This isn't a perfect guarantee but prevents flushing a file
    // that the flusher task is actively writing to in large chunks.
    while (xStreamBufferBytesAvailable(_stream) > DLF_SD_BLOCK_WRITE_SIZE) {
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    // Lock the file mutex to prevent race conditions with the flusher task
    if (xSemaphoreTake(_file_mutex, portMAX_DELAY) == pdTRUE) {
        // Save current file position (where flusher task will write next)
        size_t current_pos = _f.position();

        // Update header with the last known number of ticks
        _f.seek(offsetof(dlf_logfile_header_t, tick_span));
        _f.write(reinterpret_cast<uint8_t*>(&_last_tick), sizeof(dlf_tick_t));
        _f.flush(); // Ensure the header update is written to the SD card

        // Restore the file pointer to where the flusher task left off
        _f.seek(current_pos);

        xSemaphoreGive(_file_mutex);
    }
}

void LogFile::close() {
  if (_state != LOGGING) return;

  _state = FLUSHING;
  xSemaphoreTake(_sync, portMAX_DELAY);  // wait for flusher to finish up.
  _state = CLOSED;

  // Cleanup dynamic allocations
  vStreamBufferDelete(_stream);
  vSemaphoreDelete(_sync);
  vSemaphoreDelete(_file_mutex);

  // Finally, update and close file
  _close_file();
  Serial.println("Logfile closed cleanly");
}
}  // namespace dlf
