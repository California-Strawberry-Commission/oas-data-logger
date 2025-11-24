#include "dlflib/dlf_run.h"

#include <time.h>

#include "dlflib/util/util.h"
#include "dlflib/util/uuid.h"

namespace dlf {

Run::Run(fs::FS& fs, String fs_dir, dlf::datastream::streams_t all_streams,
         std::chrono::microseconds tick_interval, Encodable& meta)
    : _fs(fs), _streams(all_streams), _tick_interval(tick_interval) {
  assert(tick_interval.count() > 0);

  _uuid = dlf::util::stringUuidGen();
  _run_dir = dlf::util::resolvePath({fs_dir, _uuid});
  _lockfile_path = dlf::util::resolvePath({_run_dir, LOCKFILE_NAME});
  _sync = xSemaphoreCreateCounting(1, 0);

  Serial.printf("Starting run %s\n", _uuid.c_str());

  // Make directory to contain run files
  _fs.mkdir(_run_dir);

  // Create the lockfile first, as the presence of the lockfile indicates that
  // the run is incomplete and should not be uploaded
  create_lockfile();

  // Writes metafile for this log
  create_metafile(meta);

  // Create logfile instances
  create_logfile(POLLED);
  create_logfile(EVENT);

  Serial.println("Logfiles inited");

  _status = LOGGING;

  // Setup ticks
  xTaskCreate(task_sampler, "Sampler", 4096 * 2, this, 5, NULL);
}

void Run::create_metafile(Encodable& meta) {
  dlf_meta_header_t h;
  time_t now = time(NULL);
  h.epoch_time_s = now;
  h.tick_base_us = _tick_interval.count();
  h.meta_structure = meta.type_structure;
  h.meta_size = meta.data_size;

#ifdef DEBUG
  DEBUG.printf(
      "Creating metafile\n"
      "\tepoch_time_s: %lu\n"
      "\ttick_base_us: %lu\n"
      "\tmeta_structure: %s (hash: %x)\n",
      h.epoch_time_s, h.tick_base_us, h.meta_structure, meta.type_hash);
#endif
  fs::File f =
      _fs.open(dlf::util::resolvePath({_run_dir, "meta.dlf"}), "w", true);

  f.write(reinterpret_cast<uint8_t*>(&h.magic), sizeof(h.magic));
  f.write(reinterpret_cast<uint8_t*>(&h.epoch_time_s), sizeof(h.epoch_time_s));
  f.write(reinterpret_cast<uint8_t*>(&h.tick_base_us), sizeof(h.tick_base_us));
  f.write((uint8_t*)h.meta_structure, strlen(h.meta_structure) + 1);
  f.write(reinterpret_cast<uint8_t*>(&h.meta_size), sizeof(h.meta_size));
  f.write(meta.data, h.meta_size);

  f.close();
}

void Run::create_logfile(dlf_stream_type_e t) {
#ifdef DEBUG
  DEBUG.printf("Creating %s logfile\n", dlf::datastream::streamTypeToString(t));
#endif
  dlf::datastream::stream_handles_t handles;

  size_t idx = 0;
  for (auto& stream : _streams) {
    if (stream->type() == t) {
      handles.push_back(std::move(stream->handle(_tick_interval, idx++)));
    }
  }
  _log_files.push_back(std::unique_ptr<LogFile>(
      new LogFile(std::move(handles), t, _run_dir, _fs)));
}

void Run::task_sampler(void* arg) {
  Serial.println("Sampler inited");
  auto self = static_cast<Run*>(arg);

  const TickType_t interval =
      std::chrono::duration_cast<DLF_FREERTOS_DURATION>(self->_tick_interval)
          .count();
  Serial.printf("Interval %d\n", interval);

  TickType_t prev_run = xTaskGetTickCount();

  // Run at constant tick interval
  for (dlf_tick_t tick = 0; self->_status == LOGGING; tick++) {
#if defined(DEBUG) && defined(SILLY)
    DEBUG.printf("Sample\n\ttick: %d\n", tick);
#endif
    for (auto& lf : self->_log_files) {
      lf->sample(tick);
    }
    xTaskDelayUntil(&prev_run, interval);
  }
#ifdef DEBUG
  DEBUG.println("Sampler exiting cleanly");
#endif

  xSemaphoreGive(self->_sync);
  vTaskDelete(NULL);
}

void Run::close() {
  Serial.println("Closing run!");
  _status = FLUSHING;

  // Wait for sampling task to cleanly exit.
  xSemaphoreTake(_sync, portMAX_DELAY);
  vSemaphoreDelete(_sync);

  for (auto& lf : _log_files) {
    lf->close();
  }

  // Remove the lockfile last, as the presence of the lockfile indicates that
  // the run is incomplete and should not be uploaded
  Serial.printf("[RUN] Removing lockfile: %s\n", _lockfile_path.c_str());
  bool lockfileRemoved = _fs.remove(_lockfile_path);
  if (lockfileRemoved) {
    Serial.println("[RUN] Lockfile successfully removed");
  } else {
    Serial.println("[RUN] WARNING: Failed to remove lockfile!");
  }

  // Verify lockfile was actually deleted by listing directory contents
  Serial.printf("[RUN] Verifying run directory contents for %s:\n",
                _run_dir.c_str());
  fs::File runDir = _fs.open(_run_dir);
  if (runDir && runDir.isDirectory()) {
    fs::File file;
    while (file = runDir.openNextFile()) {
      Serial.printf("[RUN]   - %s (%d bytes)\n", file.name(), file.size());
      file.close();
    }
    runDir.close();
  } else {
    Serial.println(
        "[RUN] WARNING: Could not open run directory for verification!");
  }

  Serial.println("Run closed cleanly!");
}

const char* Run::uuid() { return _uuid.c_str(); }

void Run::create_lockfile() {
#ifdef DEBUG
  Serial.println("Creating lockfile");
#endif

  fs::File f = _fs.open(_lockfile_path, "w", true);
  f.write(0);
  f.close();
}

}  // namespace dlf
