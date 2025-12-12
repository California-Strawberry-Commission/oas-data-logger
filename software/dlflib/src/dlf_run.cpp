#include "dlflib/dlf_run.h"

#include <time.h>

#include "dlflib/dlf_cfg.h"
#include "dlflib/util/util.h"
#include "dlflib/util/uuid.h"

namespace dlf {

Run::Run(fs::FS& fs, String fsDir, dlf::datastream::streams_t streams,
         std::chrono::microseconds tickInterval, Encodable& meta)
    : fs_(fs), streams_(streams), tickInterval_(tickInterval) {
  assert(tickInterval.count() > 0);

  uuid_ = dlf::util::stringUuidGen();
  runDir_ = dlf::util::resolvePath({fsDir, uuid_});
  lockfilePath_ = dlf::util::resolvePath({runDir_, LOCKFILE_NAME});
  syncSemaphore_ = xSemaphoreCreateCounting(1, 0);

  Serial.printf("[Run] Starting run %s\n", uuid_.c_str());

  // Make directory to contain run files
  fs_.mkdir(runDir_);

  // Create the lockfile first, as the presence of the lockfile indicates that
  // the run is incomplete and should not be uploaded
  createLockfile();

  // Writes metafile for this log
  createMetafile(meta);

  // Create logfile instances
  createLogfile(POLLED);
  createLogfile(EVENT);

  Serial.println("[Run] Logfiles inited");

  status_ = LOGGING;

  // Setup ticks
  xTaskCreate(taskSampler, "Sampler", 4096 * 2, this, 5, NULL);
}

void Run::close() {
  Serial.println("[Run] Closing run...");
  status_ = FLUSHING;

  // Wait for sampling task to cleanly exit.
  xSemaphoreTake(syncSemaphore_, portMAX_DELAY);
  vSemaphoreDelete(syncSemaphore_);

  for (auto& lf : logFiles_) {
    lf->close();
  }

  // Remove the lockfile last, as the presence of the lockfile indicates that
  // the run is incomplete and should not be uploaded
  Serial.printf("[Run] Removing lockfile: %s\n", lockfilePath_.c_str());
  bool lockfileRemoved = fs_.remove(lockfilePath_);
  if (lockfileRemoved) {
    Serial.println("[Run] Lockfile successfully removed");
  } else {
    Serial.println("[Run] WARNING: Failed to remove lockfile!");
  }

  // Verify lockfile was actually deleted by listing directory contents
  Serial.printf("[Run] Verifying run directory contents for %s:\n",
                runDir_.c_str());
  fs::File runDir = fs_.open(runDir_);
  if (runDir && runDir.isDirectory()) {
    fs::File file;
    while (file = runDir.openNextFile()) {
      Serial.printf("\t- %s (%d bytes)\n", file.name(), file.size());
      file.close();
    }
    runDir.close();
  } else {
    Serial.println(
        "[Run] WARNING: Could not open run directory for verification!");
  }

  Serial.println("[Run] Run closed cleanly");
}

void Run::flushLogFiles() {
  if (status_ != LOGGING) {
    return;
  }

  for (auto& lf : logFiles_) {
    lf->flush();
  }
}

void Run::lockAllLogFiles() {
  for (auto& lf : logFiles_) {
    lf->lock();
  }
}

void Run::unlockAllLogFiles() {
  for (auto& lf : logFiles_) {
    lf->unlock();
  }
}

void Run::createMetafile(Encodable& meta) {
  dlf_meta_header_t h;
  time_t now = time(NULL);
  h.epoch_time_s = now;
  h.tick_base_us = tickInterval_.count();
  h.meta_structure = meta.typeStructure;
  h.meta_size = meta.dataSize;

#ifdef DEBUG
  Serial.printf(
      "[Run] Creating metafile\n"
      "\tepoch_time_s: %lu\n"
      "\ttick_base_us: %lu\n"
      "\tmeta_structure: %s (hash: %x)\n",
      h.epoch_time_s, h.tick_base_us, h.meta_structure, meta.typeHash);
#endif

  fs::File f =
      fs_.open(dlf::util::resolvePath({runDir_, "meta.dlf"}), "w", true);

  f.write(reinterpret_cast<uint8_t*>(&h.magic), sizeof(h.magic));
  f.write(reinterpret_cast<uint8_t*>(&h.epoch_time_s), sizeof(h.epoch_time_s));
  f.write(reinterpret_cast<uint8_t*>(&h.tick_base_us), sizeof(h.tick_base_us));
  f.write((uint8_t*)h.meta_structure, strlen(h.meta_structure) + 1);
  f.write(reinterpret_cast<uint8_t*>(&h.meta_size), sizeof(h.meta_size));
  f.write(meta.data, h.meta_size);

  f.close();
}

void Run::createLogfile(dlf_stream_type_e t) {
#ifdef DEBUG
  Serial.printf("[Run] Creating %s logfile\n",
                dlf::datastream::streamTypeToString(t));
#endif
  dlf::datastream::stream_handles_t handles;

  size_t idx = 0;
  for (auto& stream : streams_) {
    if (stream->type() == t) {
      handles.push_back(std::move(stream->handle(tickInterval_, idx++)));
    }
  }
  logFiles_.push_back(std::unique_ptr<LogFile>(
      new LogFile(std::move(handles), t, runDir_, fs_)));
}

void Run::taskSampler(void* arg) {
  auto self = static_cast<Run*>(arg);

  const TickType_t interval =
      std::chrono::duration_cast<DLF_FREERTOS_DURATION>(self->tickInterval_)
          .count();
  Serial.printf("[Run][taskSampler] Interval (RTOS ticks): %d\n", interval);

  TickType_t prev_run = xTaskGetTickCount();

  // Run at constant tick interval
  for (dlf_tick_t tick = 0; self->status_ == LOGGING; tick++) {
    for (auto& lf : self->logFiles_) {
      lf->sample(tick);
    }
    xTaskDelayUntil(&prev_run, interval);
  }

  Serial.println("[Run][taskSampler] Sampler task exiting cleanly");

  xSemaphoreGive(self->syncSemaphore_);
  vTaskDelete(NULL);
}

void Run::createLockfile() {
#ifdef DEBUG
  Serial.println("[Run] Creating lockfile");
#endif

  fs::File f = fs_.open(lockfilePath_, "w", true);
  f.write(0);
  f.close();
}

}  // namespace dlf
