#pragma once

#include <Arduino.h>
#include <FS.h>
#include <stdint.h>

#include <chrono>
#include <memory>
#include <vector>

#include "dlflib/datastream/abstract_stream.h"
#include "dlflib/dlf_logfile.h"
#include "dlflib/dlf_types.h"

namespace dlf {

// Todo: Performance timings

class Run {
 public:
  Run(fs::FS& fs, String fsDir, dlf::datastream::streams_t streams,
      std::chrono::microseconds tickInterval, Encodable& meta);

  void close();

  const char* uuid() { return uuid_.c_str(); }

 private:
  static void taskSampler(void* arg);

  void createLockfile();

  void createMetafile(Encodable& meta);

  void createLogfile(dlf_stream_type_e t);

  String uuid_;
  fs::FS& fs_;
  String runDir_;
  dlf_file_state_e status_;
  SemaphoreHandle_t syncSemaphore_;
  std::chrono::microseconds tickInterval_;
  dlf::datastream::streams_t streams_;
  std::vector<std::unique_ptr<LogFile>> logFiles_;
  String lockfilePath_;
};

}  // namespace dlf