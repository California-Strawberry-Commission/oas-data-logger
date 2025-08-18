#pragma once

#include <Arduino.h>
#include <FS.h>
#include <stdint.h>
#include <uuid.h>

#include <chrono>
#include <memory>
#include <vector>

#include "datastream/AbstractStream.hpp"
#include "dlf_cfg.h"
#include "dlf_logfile.hpp"
#include "dlf_types.h"

namespace dlf {
using namespace std;

// Todo: Performance timings

class Run {
 private:
  String _uuid;
  FS &_fs;
  String _run_dir;
  dlf_file_state_e _status;
  SemaphoreHandle_t _sync;
  chrono::microseconds _tick_interval;
  streams_t _streams;
  vector<unique_ptr<LogFile>> _log_files;

  String _lockfile_path;

 public:
  Run(FS &fs, String fs_dir, streams_t all_streams,
      chrono::microseconds tick_interval, Encodable &meta);

  void create_lockfile();

  void create_metafile(Encodable &meta);

  void create_logfile(dlf_stream_type_e t);

  /**
   * NOTE: Has caused canary issues if stack too small (1024 is problematic).
   * @brief
   * @param arg
   */
  static void task_sampler(void *arg);

  void close();

  void flush(); 

  const char *uuid();
};

}  // namespace dlf