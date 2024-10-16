#include "dlf_run.h"

namespace dlf {
Run::Run(FS &fs, streams_t all_streams, chrono::microseconds tick_interval, Encodable &meta)
    : _fs(fs), _streams(all_streams), _tick_interval(tick_interval) {
    assert(tick_interval.count() > 0);

    _uuid = "/" + StringUUIDGen();
    _lockfile_path = _uuid + "/" + LOCKFILE_NAME;
    _sync = xSemaphoreCreateCounting(1, 0);

#ifdef DEBUG
    Serial.printf("Starting run %s\n", _uuid.c_str());
#endif

    // Make directory to contain run files.
    _fs.mkdir(_uuid);

    create_lockfile();
    
    // Writes metafile for this log.
    create_metafile(meta);

    // Create logfile instances
    create_logfile(POLLED);
    create_logfile(EVENT);

    Serial.println("Logfiles inited");

    _status = LOGGING;

    // Setup ticks
    xTaskCreate(task_sampler, "Sampler", 4096 * 2, this, 5, NULL);
}

void Run::create_metafile(Encodable &meta) {
    dlf_meta_header_t h;
    h.tick_base_us = _tick_interval.count();
    h.meta_structure = meta.type_structure;
    h.meta_size = meta.data_size;

#ifdef DEBUG
    DEBUG.printf(
        "Creating metafile\n"
        "\ttick_base_us: %lu\n"
        "\tmeta_structure: %s (hash: %x)\n",
        h.tick_base_us, h.meta_structure, meta.type_hash);
#endif
    File f = _fs.open(_uuid + "/meta.dlf", "w", true);

    // Directly write metadata into the file. No need to
    // use a streambuffer like in Logfile metadata writes
    // TODO: clean this up
    f.write(reinterpret_cast<uint8_t *>(&h.magic), sizeof(h.magic));
    f.write(reinterpret_cast<uint8_t *>(&h.tick_base_us), sizeof(h.tick_base_us));
    f.write((uint8_t *)h.meta_structure, strlen(h.meta_structure) + 1);
    f.write(reinterpret_cast<uint8_t *>(&h.meta_size), sizeof(h.meta_size));
    f.write(reinterpret_cast<uint8_t *>(&meta), h.meta_size);

    f.close();
}

void Run::create_logfile(dlf_stream_type_e t) {
#ifdef DEBUG
    DEBUG.printf("Creating %s logfile\n", stream_type_to_string(t));
#endif
    stream_handles_t handles;

    size_t idx = 0;
    for (auto &stream : _streams) {
        if (stream->type() == t) {
            handles.push_back(move(stream->handle(_tick_interval, idx++)));
        }
    }
    _log_files.push_back(unique_ptr<LogFile>(new LogFile(move(handles), t, _uuid, _fs)));
}

void Run::task_sampler(void *arg) {
    Serial.println("Sampler inited");
    auto self = static_cast<Run *>(arg);

    const TickType_t interval = chrono::duration_cast<DLF_FREERTOS_DURATION>(self->_tick_interval).count();
    Serial.printf("Interval %d\n", interval);

    TickType_t prev_run = xTaskGetTickCount();

    // Run at constant tick interval
    for (dlf_tick_t tick = 0; self->_status == LOGGING; tick++) {
#if defined(DEBUG) && defined(SILLY)
        DEBUG.printf("Sample\n\ttick: %d\n", tick);
#endif
        for (auto &lf : self->_log_files) {
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

    for (auto &lf : _log_files) {
        lf->close();
    }

    // delete lockfile
    _fs.remove(_lockfile_path);

    Serial.println("Run closed cleanly!");
}

const char *Run::uuid() {
    return _uuid.c_str();
}

void Run::create_lockfile() {
    File f = _fs.open(_lockfile_path, "w", true);
    f.write(0);
    f.close();
}

}  // namespace dlf
