#include "dlflib/dlf_logfile.h"

#include "dlflib/datastream/event_stream.h"
#include "dlflib/datastream/polled_stream.h"
#include "dlflib/dlf_cfg.h"
#include "dlflib/util/util.h"
#include "dlflib/util/uuid.h"

namespace dlf {

/**
 * @brief Task responsible for writing data to SD
 * Constantly receives data from stream_ streambuffer and writes to SD.
 * @param arg
 */
void LogFile::taskFlusher(void* arg) {
  auto self = static_cast<LogFile*>(arg);

  Serial.printf("[FLUSHER] Task started for %s\n", self->filename_.c_str());

  uint8_t buf[DLF_SD_BLOCK_WRITE_SIZE];
  size_t totalBytesWritten = 0;
  const uint32_t SYNC_INTERVAL_MS = 60000;
  const size_t SYNC_THRESHOLD_BYTES = 4096;
  uint32_t lastSyncTime = millis();
  size_t bytesSinceLastSync = 0;

  while (self->state_ == LOGGING) {
    size_t received = xStreamBufferReceive(self->stream_, buf, sizeof(buf),
                                           pdMS_TO_TICKS(1000));

    if (received > 0) {
      Serial.printf("[FLUSHER] %s: Received %zu bytes from buffer\n",
                    self->filename_.c_str(), received);

      // Lock file mutex before writing
      if (xSemaphoreTake(self->fileMutex_, portMAX_DELAY) == pdTRUE) {
        self->file_.write(buf, received);
        totalBytesWritten += received;
        bytesSinceLastSync += received;

        // Track the file end position for proper close
        self->fileEndPosition_ = totalBytesWritten;

        // Force SD card sync after 60 seconds or 4KB written
        // .flush() commits data the SD card
        // only on .close() will directory entry be updated (e.g. 9MB to 10MB)
        if ((bytesSinceLastSync >= SYNC_THRESHOLD_BYTES ||
             (millis() - lastSyncTime) >= SYNC_INTERVAL_MS) &&
            bytesSinceLastSync > 0) {
          Serial.printf("[FLUSHER] %s: Forcing SD sync (close/reopen)...\n",
                        self->filename_.c_str());

          String fname = self->filename_;
          self->file_.flush();
          self->file_.close();

          // Reopen in append mode
          self->file_ = self->fs_.open(fname, "a");
          if (!self->file_) {
            Serial.printf(
                "[FLUSHER] ERROR: Could not reopen file after sync!\n");
          } else {
            Serial.printf("[FLUSHER] %s: SD sync complete, file reopened\n",
                          self->filename_.c_str());
          }

          lastSyncTime = millis();
          bytesSinceLastSync = 0;
        } else {
          // Regular flush (may not reach SD card)
          self->file_.flush();
        }

        Serial.printf("[FLUSHER] %s: Wrote %zu bytes, total: %zu\n",
                      self->filename_.c_str(), received, totalBytesWritten);

        xSemaphoreGive(self->fileMutex_);
      } else {
        Serial.printf("[FLUSHER] %s: FAILED to acquire mutex!\n",
                      self->filename_.c_str());
      }
    }
  }

  /* BEGIN EXIT - NO LONGER IN LOGGING STATE */

  // If errored, exit immediately
  if (self->state_ != FLUSHING) {
    Serial.printf("FLUSHER ERROR WITH %x\n", self->state_);

    vTaskDelete(NULL);
    return;
  }

  Serial.println("Flushing remaining bytes...");
  // Flush remaining bytes
  while (xStreamBufferBytesAvailable(self->stream_) > 0 &&
         self->state_ == FLUSHING) {
    size_t received = xStreamBufferReceive(self->stream_, buf, sizeof(buf), 0);

    if (received > 0) {
      // Lock file mutex before writing
      if (xSemaphoreTake(self->fileMutex_, portMAX_DELAY) == pdTRUE) {
        self->file_.write(buf, received);
        totalBytesWritten += received;
        self->fileEndPosition_ = totalBytesWritten;
        xSemaphoreGive(self->fileMutex_);
      }
    }
  }

  // CRITICAL: Final SD sync - close and reopen to force all remaining data to
  // SD card This must happen BEFORE we signal completion so closeFile doesn't
  // run yet
  if (xSemaphoreTake(self->fileMutex_, portMAX_DELAY) == pdTRUE) {
    Serial.printf("[FLUSHER] Performing final SD sync...\n");

    String fname = self->filename_;
    self->file_.flush();
    self->file_.close();

    // Reopen in read-write mode (not append) so closeFile can use it
    self->file_ = self->fs_.open(fname, "r+");
    if (self->file_) {
      // Seek to end so we know where data ends
      self->file_.seek(0, SeekEnd);
      size_t actualFileSize = self->file_.position();
      Serial.printf(
          "[FLUSHER] Final SD sync complete. Actual file size: %zu bytes\n",
          actualFileSize);

      // Close it - closeFile will reopen for header update
      self->file_.close();
    } else {
      Serial.printf(
          "[FLUSHER] ERROR: Could not reopen file for final sync "
          "verification!\n");
    }

    self->fileEndPosition_ = totalBytesWritten;
    Serial.printf(
        "[FLUSHER] Final flush complete. Total bytes written: %zu, file end "
        "position: %zu\n",
        totalBytesWritten, self->fileEndPosition_);
    xSemaphoreGive(self->fileMutex_);
  }

  self->state_ = FLUSHED;
  xSemaphoreGive(self->syncMutex_);

  Serial.printf("Flusher exited cleanly w/ HWM %u\n",
                uxTaskGetStackHighWaterMark(NULL));
  vTaskDelete(NULL);
}

void LogFile::writeHeader(dlf_stream_type_e streamType) {
  dlf_logfile_header_t h;
  h.stream_type = streamType;
  h.num_streams = handles_.size();
  xStreamBufferSend(stream_, &h, sizeof(h), portMAX_DELAY);

  for (auto& handle : handles_) {
    handle->encodeHeaderInto(stream_);
  }
}

void LogFile::closeFile() {
  Serial.printf("[CLOSE_FILE] Closing file, tracked end position: %zu\n",
                fileEndPosition_);

  // Get file name for debugging
  String fname = filename_;

  // Flush and close current write handle
  file_.flush();
  file_.close();

  Serial.printf("[CLOSE_FILE] File closed, checking actual size on SD...\n");

  // Check file size on SD before header update
  fs::File checkFile = fs_.open(fname, "r");
  if (checkFile) {
    size_t sizeBeforeUpdate = checkFile.size();
    Serial.printf(
        "[CLOSE_FILE] File size on SD BEFORE header update: %zu bytes\n",
        sizeBeforeUpdate);
    checkFile.close();
  }

  // Reopen in read/write mode to update header
  file_ = fs_.open(fname, "r+");
  if (!file_) {
    Serial.printf(
        "[CLOSE_FILE] ERROR: Could not reopen file for header update!\n");
    return;
  }

  // Update header with # of ticks
  file_.seek(offsetof(dlf_logfile_header_t, tick_span));
  file_.write(reinterpret_cast<uint8_t*>(&lastTick_), sizeof(dlf_tick_t));
  file_.flush();
  file_.close();

  // Check file size after header update
  checkFile = fs_.open(fname, "r");
  if (checkFile) {
    size_t sizeAfterUpdate = checkFile.size();
    Serial.printf(
        "[CLOSE_FILE] File size on SD AFTER header update: %zu bytes\n",
        sizeAfterUpdate);
    checkFile.close();
  }

  Serial.printf("[CLOSE_FILE] Header update complete\n");
}

LogFile::LogFile(dlf::datastream::stream_handles_t handles,
                 dlf_stream_type_e streamType, String dir, fs::FS& fs)
    : fs_(fs), handles_(std::move(handles)), fileEndPosition_(0) {
  filename_ =
      dir + "/" + dlf::datastream::streamTypeToString(streamType) + ".dlf";

  // Set up class internals
  stream_ =
      xStreamBufferCreate(DLF_LOGFILE_BUFFER_SIZE, DLF_SD_BLOCK_WRITE_SIZE);
  if (stream_ == NULL) {
    state_ = STREAM_CREATE_ERROR;
    return;
  }

  syncMutex_ = xSemaphoreCreateCounting(1, 0);
  if (syncMutex_ == NULL) {
    state_ = SYNC_CREATE_ERROR;
    return;
  }

  fileMutex_ = xSemaphoreCreateMutex();
  if (fileMutex_ == NULL) {
    state_ = SYNC_CREATE_ERROR;
    return;
  }

  // Open logfile
  file_ = fs_.open(filename_, "w", true);

  if (!file_) {
    state_ = FILE_OPEN_ERROR;
    return;
  }

  // Init data flusher
  state_ = LOGGING;

  // Increased stack size from 2048 to 4096 to handle deep SD card call stack
  // (especially for file_.size() and file_.position() which trigger
  // vfs/fatfs/sdmmc operations)
  if (xTaskCreate(taskFlusher, "Flusher", 4096, this, 5, NULL) != pdTRUE) {
    state_ = FLUSHER_CREATE_ERROR;
    return;
  }

  // Initialize logfile
  writeHeader(streamType);
}

/**
 * @brief Samples data. Intended to be externally called at the tick interval.
 *
 * Called by the Run class to trigger a sample.
 *
 * @param tick
 */
void LogFile::sample(dlf_tick_t tick) {
  if (state_ != LOGGING) {
    return;
  }

  lastTick_ = tick;

  // Sample all handles
  for (auto& h : handles_) {
    if (h->available(tick)) {
      size_t beforeBytes = xStreamBufferBytesAvailable(stream_);
      h->encodeInto(stream_, tick);
      size_t afterBytes = xStreamBufferBytesAvailable(stream_);

      // Diagnostic: Print when data is added to stream buffer
      if (afterBytes > beforeBytes && tick % 100 == 0) {
        Serial.printf(
            "[SAMPLE] Tick %llu: Added %zu bytes to %s buffer (total: %zu)\n",
            tick, afterBytes - beforeBytes, filename_.c_str(), afterBytes);
      }

      if (xStreamBufferIsFull(stream_)) {
        Serial.printf("[ERROR] QUEUE_FULL for %s at tick %llu\n",
                      filename_.c_str(), tick);
        state_ = QUEUE_FULL;
      }
    }
  }
}

void LogFile::flush() {
  if (state_ != LOGGING) {
    return;
  }

  // Wait for the stream buffer to be mostly empty
  // This isn't a perfect guarantee but prevents flushing a file
  // that the flusher task is actively writing to in large chunks.
  while (xStreamBufferBytesAvailable(stream_) > DLF_SD_BLOCK_WRITE_SIZE) {
    vTaskDelay(pdMS_TO_TICKS(10));
  }

  // Lock the file mutex to prevent race conditions with the flusher task
  if (xSemaphoreTake(fileMutex_, portMAX_DELAY) == pdTRUE) {
    // Save current file position (where flusher task will write next)
    size_t current_pos = file_.position();

    // Update header with the last known number of ticks
    file_.seek(offsetof(dlf_logfile_header_t, tick_span));
    file_.write(reinterpret_cast<uint8_t*>(&lastTick_), sizeof(dlf_tick_t));
    file_.flush();  // Ensure the header update is written to the SD card

    // Restore the file pointer to where the flusher task left off
    file_.seek(current_pos);

    xSemaphoreGive(fileMutex_);
  }
}

void LogFile::close() {
  if (state_ != LOGGING) {
    return;
  }

  state_ = FLUSHING;
  xSemaphoreTake(syncMutex_, portMAX_DELAY);  // wait for flusher to finish up.
  state_ = CLOSED;

  // Cleanup dynamic allocations
  vStreamBufferDelete(stream_);
  vSemaphoreDelete(syncMutex_);
  vSemaphoreDelete(fileMutex_);

  // Finally, update and close file
  closeFile();
  Serial.println("Logfile closed cleanly");
}

}  // namespace dlf
