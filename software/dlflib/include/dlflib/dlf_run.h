#pragma once

#include <Arduino.h>
#include <FS.h>
#include <stdint.h>

#include <chrono>
#include <memory>
#include <vector>

#include "dlflib/datastream/abstract_stream.h"
#include "dlflib/dlf_cfg.h"
#include "dlflib/dlf_logfile.h"
#include "dlflib/dlf_types.h"
#include "dlflib/utils/uuid.h"

namespace dlf {

// Todo: Performance timings

class Run {
 private:
  String _uuid;
  fs::FS& _fs;
  String _run_dir;
  dlf_file_state_e _status;
  SemaphoreHandle_t _sync;
  std::chrono::microseconds _tick_interval;
  dlf::datastream::streams_t _streams;
  std::vector<std::unique_ptr<LogFile>> _log_files;

  String _lockfile_path;

 public:
  Run(fs::FS& fs, String fs_dir, dlf::datastream::streams_t all_streams,
      std::chrono::microseconds tick_interval, Encodable& meta);

  void create_lockfile();

  void create_metafile(Encodable& meta);

  void create_logfile(dlf_stream_type_e t);

  /**
   * NOTE: Has caused canary issues if stack too small (1024 is problematic).
   * @brief
   * @param arg
   */
  static void task_sampler(void* arg);

  void close();

  const char* uuid();
};

}  // namespace dlf