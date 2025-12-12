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

  /**
   * End the run. Cleans up and closes out log files.
   */
  void close();

  const char* uuid() { return uuid_.c_str(); }

  /**
   * Force a manual flush of log files.
   */
  void flushLogFiles();

  /**
   * Acquire locks on all log files.
   */
  void lockAllLogFiles();

  /**
   * Release locks on all log files.
   */
  void unlockAllLogFiles();

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

/**
 * RAII guard for locking and unlocking all LogFile mutexes for a specific Run.
 */
class RunLogFilesLock {
 public:
  explicit RunLogFilesLock(Run* run) : run_(run) {
    if (run_) {
      run_->lockAllLogFiles();
    }
  }

  // Non-copyable
  RunLogFilesLock(const RunLogFilesLock&) = delete;
  RunLogFilesLock& operator=(const RunLogFilesLock&) = delete;

  // Movable
  RunLogFilesLock(RunLogFilesLock&& other) noexcept : run_(other.run_) {
    other.run_ = nullptr;
  }

  ~RunLogFilesLock() {
    if (run_) {
      run_->unlockAllLogFiles();
    }
  }

 private:
  Run* run_;
};

}  // namespace dlf