#include "dlflib/dlf_logfile.h"

#include "dlflib/datastream/event_stream.h"
#include "dlflib/datastream/polled_stream.h"
#include "dlflib/dlf_cfg.h"
#include "dlflib/log.h"
#include "dlflib/util/util.h"
#include "dlflib/util/uuid.h"

namespace dlf {

namespace {

FileWriteIssueHandler writeIssueHandler;

}  // namespace

void setFileWriteIssueHandler(FileWriteIssueHandler handler) {
  writeIssueHandler = std::move(handler);
}

void LogFile::reportWriteIssue(FileWriteIssue::Type type, uint32_t attempts,
                               uint32_t uptimeMs, uint32_t durationMs) {
  if (writeIssueHandler) {
    writeIssueHandler({type, streamType_,
                       static_cast<uint32_t>(fileEndPosition_), attempts,
                       uptimeMs, durationMs});
  }
}

/**
 * @brief Task responsible for writing data to SD
 * Constantly receives data from stream_ streambuffer and writes to SD.
 * @param arg
 */
void LogFile::taskFlusher(void* arg) {
  auto self = static_cast<LogFile*>(arg);

  DLFLIB_LOG_INFO("[LogFile][taskFlusher] Task started for %s",
                  self->filename_);

  uint8_t buf[DLF_SD_BLOCK_WRITE_SIZE];
  const uint32_t SYNC_INTERVAL_MS = 60000;
  const size_t SYNC_THRESHOLD_BYTES = 4096;
  uint32_t lastSyncTime = millis();
  size_t bytesSinceLastSync = 0;

  // How long to retry a failed write while logging. While retrying, the
  // sampler keeps filling the stream buffer and blocks once it is full.
  const uint32_t WRITE_TIMEOUT_MS = 60000;

  while (self->state_ == LOGGING) {
    size_t received = xStreamBufferReceive(self->stream_, buf, sizeof(buf),
                                           pdMS_TO_TICKS(1000));

    if (received > 0) {
#ifdef DEBUG
      DLFLIB_LOG_DEBUG(
          "[LogFile][taskFlusher] %s: Received %zu bytes from buffer",
          self->filename_, received);
#endif

      // Lock file mutex before writing
      if (xSemaphoreTake(self->fileMutex_, portMAX_DELAY) == pdTRUE) {
        if (self->writeChunk(buf, received, WRITE_TIMEOUT_MS)) {
          bytesSinceLastSync += received;
        }

        // Force SD card sync after 60 seconds or 4KB written.
        // flush() commits data to the SD card.
        // Only on close() will directory entry be updated (e.g. 9MB to 10MB)
        if ((bytesSinceLastSync >= SYNC_THRESHOLD_BYTES ||
             (millis() - lastSyncTime) >= SYNC_INTERVAL_MS) &&
            bytesSinceLastSync > 0) {
          DLFLIB_LOG_INFO("[LogFile][taskFlusher] Forcing SD sync: %s",
                          self->filename_);

          self->file_.flush();
          self->file_.close();
          if (self->reopen()) {
            DLFLIB_LOG_INFO(
                "[LogFile][taskFlusher] SD sync complete, file reopened: %s",
                self->filename_);
          } else {
            // Note that writeChunk will attempt to reopen the file on its next
            // write.
            DLFLIB_LOG_ERROR(
                "[LogFile][taskFlusher] Failed to reopen file during SD sync: "
                "%s",
                self->filename_);
          }

          lastSyncTime = millis();
          bytesSinceLastSync = 0;
        }

#ifdef DEBUG
        DLFLIB_LOG_DEBUG(
            "[LogFile][taskFlusher] %s: Wrote %zu bytes, total: %zu",
            self->filename_, received, self->fileEndPosition_);
#endif

        xSemaphoreGive(self->fileMutex_);
      } else {
        DLFLIB_LOG_ERROR(
            "[LogFile][taskFlusher] Failed to acquire file mutex: %s",
            self->filename_);
      }
    }
  }

  DLFLIB_LOG_INFO(
      "[LogFile][taskFlusher] No longer in LOGGING state. Current state: %x",
      self->state_);

  // If no need to flush, exit immediately
  if (self->state_ != FLUSHING) {
    DLFLIB_LOG_INFO(
        "[LogFile][taskFlusher] No need to flush. Terminating task.");
    vTaskDelete(NULL);
    return;
  }

  DLFLIB_LOG_INFO("[LogFile][taskFlusher] Flushing remaining bytes...");
  // Flush remaining bytes
  while (xStreamBufferBytesAvailable(self->stream_) > 0 &&
         self->state_ == FLUSHING) {
    size_t received = xStreamBufferReceive(self->stream_, buf, sizeof(buf), 0);

    if (received > 0) {
      // Lock file mutex before writing
      if (xSemaphoreTake(self->fileMutex_, portMAX_DELAY) == pdTRUE) {
        // The file handle may be invalid if the file reopen attempt failed
        // while exiting the LOGGING state, but writeChunk recovers it.
        self->writeChunk(buf, received, 10000);
        xSemaphoreGive(self->fileMutex_);
      }
    }
  }

  // CRITICAL: Final SD sync - close and reopen to force all remaining data to
  // SD card This must happen BEFORE we signal completion so closeFile doesn't
  // run yet
  if (xSemaphoreTake(self->fileMutex_, portMAX_DELAY) == pdTRUE) {
    DLFLIB_LOG_INFO("[LogFile][taskFlusher] Performing final SD sync...");

    self->file_.flush();
    self->file_.close();

    self->file_ = self->fs_.open(self->filename_, "r+");
    if (self->file_) {
      // Seek to end so we know where data ends
      self->file_.seek(0, SeekEnd);
      size_t actualFileSize = self->file_.position();
      DLFLIB_LOG_INFO(
          "[LogFile][taskFlusher] Final SD sync complete for %s. Actual file "
          "size: %zu bytes",
          self->filename_, actualFileSize);
      self->file_.close();
    } else {
      DLFLIB_LOG_ERROR(
          "[LogFile][taskFlusher][FATAL] Failed to reopen file after final "
          "flush: %s",
          self->filename_);
    }

    DLFLIB_LOG_INFO(
        "[LogFile][taskFlusher] Final flush complete for %s. Total bytes "
        "written: %zu",
        self->filename_, self->fileEndPosition_);
    xSemaphoreGive(self->fileMutex_);
  }

  self->state_ = FLUSHED;
  xSemaphoreGive(self->syncSemaphore_);

  DLFLIB_LOG_INFO("[LogFile][taskFlusher] Flusher exited cleanly w/ HWM %u",
                  uxTaskGetStackHighWaterMark(nullptr));
  vTaskDelete(nullptr);
}

bool LogFile::reopen() {
  // IMPORTANT: we use "r+" (read/write) mode instead of "a" (append)
  // here because any write in append mode will always go to end of file
  // regardless of any seeks.
  file_ = fs_.open(filename_, "r+");
  if (!file_) {
    return false;
  }

  // If the file is shorter than expected, data was lost when closing. Seeking
  // past the end still keeps all subsequent data at the expected offsets, so
  // only the samples within the lost region are corrupted.
  const size_t fileSize = file_.size();
  if (fileSize != fileEndPosition_) {
    DLFLIB_LOG_ERROR(
        "[LogFile][reopen] File size %zu after reopen does not match "
        "bytes written %zu: %s",
        fileSize, fileEndPosition_, filename_);
    reportWriteIssue(FileWriteIssue::Type::SIZE_MISMATCH, 0, millis(), 0);
  }
  return file_.seek(fileEndPosition_);
}

bool LogFile::writeChunk(const uint8_t* data, size_t len, uint32_t timeoutMs) {
  if (writesAbandoned_) {
    return false;
  }

  const uint32_t WRITE_MAX_DELAY_MS = 2000;
  uint32_t delayMs = 50;
  uint32_t elapsedMs = 0;
  uint32_t firstFailureMs = 0;

  // Transient SD card errors (such as from a brownout) otherwise silently
  // discard the chunk, leaving a gap in the file. Each attempt rewrites the
  // whole chunk at the same offset, so a failed attempt never leaves a gap.
  for (uint32_t attempt = 1;; ++attempt) {
    // File::write() only copies into the stdio buffer, so it reports success
    // even when the subsequent flush to the SD card fails and the buffered
    // bytes are discarded. Checking the file position after the flush catches
    // this.
    bool written = false;
    if (file_ && file_.seek(fileEndPosition_)) {
      written = file_.write(data, len) == len;
      file_.flush();
      written = written && file_.position() == fileEndPosition_ + len;
    }
    if (written) {
      if (attempt > 1) {
        reportWriteIssue(FileWriteIssue::Type::RECOVERED, attempt - 1,
                         firstFailureMs, millis() - firstFailureMs);
      }
      fileEndPosition_ += len;
      return true;
    }

    if (attempt == 1) {
      firstFailureMs = millis();
    }

    // If writes fail even after timeout, we do not want to continue writing
    // data to this file anymore.
    if (elapsedMs >= timeoutMs) {
      DLFLIB_LOG_ERROR(
          "[LogFile][writeChunk][FATAL] Could not write %zu bytes at offset "
          "%zu within timeout. Preventing all further writes for %s",
          len, fileEndPosition_, filename_);
      writesAbandoned_ = true;
      reportWriteIssue(FileWriteIssue::Type::ABANDONED, attempt, firstFailureMs,
                       millis() - firstFailureMs);
      return false;
    }

    DLFLIB_LOG_ERROR(
        "[LogFile][writeChunk] Write of %zu bytes at offset %zu failed "
        "(attempt %u), retrying in %u ms: %s",
        len, fileEndPosition_, attempt, delayMs, filename_);
    vTaskDelay(pdMS_TO_TICKS(delayMs));
    elapsedMs += delayMs;
    delayMs =
        (delayMs * 2 < WRITE_MAX_DELAY_MS) ? delayMs * 2 : WRITE_MAX_DELAY_MS;

    // A failed write can leave the file handle in a persistent error state, so
    // also reopen the file on every other failure, or whenever it is not open.
    if (!file_ || attempt % 2 == 0) {
      file_.close();
      if (!reopen()) {
        DLFLIB_LOG_ERROR("[LogFile][writeChunk] Reopen failed: %s", filename_);
      }
    }
  }
}

LogFile::LogFile(
    std::vector<std::unique_ptr<dlf::datastream::AbstractStreamHandle>> handles,
    dlf_stream_type_e streamType, const char* dir, fs::FS& fs)
    : fs_(fs),
      handles_(std::move(handles)),
      streamType_(streamType),
      fileEndPosition_(0),
      writesAbandoned_(false),
      bufferFullLogged_(false) {
  const char* streamTypeStr = dlf::datastream::streamTypeToString(streamType);
  snprintf(filename_, sizeof(filename_), "%s/%s.dlf", dir,
           streamTypeStr ? streamTypeStr : "unknown");

  // Set up class internals
  stream_ =
      xStreamBufferCreate(DLF_LOGFILE_BUFFER_SIZE, DLF_SD_BLOCK_WRITE_SIZE);
  if (stream_ == nullptr) {
    state_ = STREAM_CREATE_ERROR;
    return;
  }

  syncSemaphore_ = xSemaphoreCreateCounting(1, 0);
  if (syncSemaphore_ == nullptr) {
    state_ = SYNC_CREATE_ERROR;
    return;
  }

  fileMutex_ = xSemaphoreCreateMutex();
  if (fileMutex_ == nullptr) {
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

  // Increased stack size from 4096 to 8192 to handle deep SD card call stack
  // (especially for file_.size() and file_.position() which trigger
  // vfs/fatfs/sdmmc operations)
  if (xTaskCreate(taskFlusher, "Flusher", 8192, this, 5, NULL) != pdTRUE) {
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

#ifdef DEBUG
      if (afterBytes > beforeBytes && tick % 100 == 0) {
        DLFLIB_LOG_DEBUG(
            "[LogFile][sample] Tick %llu: Added %zu bytes to %s buffer (total: "
            "%zu)",
            tick, afterBytes - beforeBytes, filename_, afterBytes);
      }
#endif

      // encodeInto blocks until the whole sample fits, so a full buffer doesn't
      // lose data. It does mean the flusher is falling behind, so log once
      // until the buffer drains.
      if (xStreamBufferIsFull(stream_)) {
        if (!bufferFullLogged_) {
          DLFLIB_LOG_ERROR(
              "[LogFile][sample] Stream buffer full at tick %llu: %s", tick,
              filename_);
          bufferFullLogged_ = true;
        }
      } else if (afterBytes < DLF_LOGFILE_BUFFER_SIZE / 2) {
        bufferFullLogged_ = false;
      }
    }
  }
}

void LogFile::close() {
  if (state_ != LOGGING) {
    return;
  }

  state_ = FLUSHING;
  xSemaphoreTake(syncSemaphore_,
                 portMAX_DELAY);  // wait for flusher to finish up.
  state_ = CLOSED;

  // Cleanup dynamic allocations
  vStreamBufferDelete(stream_);
  vSemaphoreDelete(syncSemaphore_);
  vSemaphoreDelete(fileMutex_);

  // Finally, update and close file
  closeFile();
  DLFLIB_LOG_INFO("[LogFile] Logfile closed cleanly");
}

void LogFile::lock() { xSemaphoreTake(fileMutex_, portMAX_DELAY); }

void LogFile::unlock() { xSemaphoreGive(fileMutex_); }

void LogFile::writeHeader(dlf_stream_type_e streamType) {
  dlf_logfile_header_t h;
  h.stream_type = streamType;
  h.tick_span = 0;  // updated on flush/close
  h.num_streams = handles_.size();
  xStreamBufferSend(stream_, &h, sizeof(h), portMAX_DELAY);

  for (auto& handle : handles_) {
    handle->encodeHeaderInto(stream_);
  }
}

void LogFile::closeFile() {
  DLFLIB_LOG_INFO(
      "[LogFile][closeFile] Closing file, tracked end position: %zu",
      fileEndPosition_);

  // Flush and close current write handle
  file_.flush();
  file_.close();

  DLFLIB_LOG_INFO(
      "[LogFile][closeFile] File closed, checking actual size on SD...");

  // Check file size on SD before header update
  fs::File checkFile = fs_.open(filename_, "r");
  if (checkFile) {
    size_t sizeBeforeUpdate = checkFile.size();
    DLFLIB_LOG_INFO(
        "[LogFile][closeFile] File size on SD BEFORE header update: %zu "
        "bytes",
        sizeBeforeUpdate);
    checkFile.close();
  }

  // Reopen file in read/write mode to update the header
  // IMPORTANT: we use "r+" (read/write) mode instead of "a" (append)
  // here because any write in append mode will always go to end of file
  // regardless of any seeks.
  file_ = fs_.open(filename_, "r+");
  if (!file_) {
    DLFLIB_LOG_ERROR(
        "[LogFile][closeFile] Could not reopen file for header update: %s",
        filename_);
    return;
  }

  // Update header with # of ticks
  file_.seek(offsetof(dlf_logfile_header_t, tick_span));
  file_.write(reinterpret_cast<uint8_t*>(&lastTick_), sizeof(dlf_tick_t));
  file_.flush();
  file_.close();

  // Check file size after header update
  checkFile = fs_.open(filename_, "r");
  if (checkFile) {
    size_t sizeAfterUpdate = checkFile.size();
    DLFLIB_LOG_INFO(
        "[LogFile][closeFile] File size on SD AFTER header update: %zu bytes",
        sizeAfterUpdate);
    checkFile.close();
  }

  DLFLIB_LOG_INFO("[LogFile][closeFile] Header update complete");
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

}  // namespace dlf
