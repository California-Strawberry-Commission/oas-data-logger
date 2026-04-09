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

class Run {
 public:
  Run(fs::FS& fs, const char* fsDir,
      const std::vector<std::unique_ptr<dlf::datastream::AbstractStream>>&
          streams,
      std::chrono::microseconds tickInterval, const Encodable& meta);

  /**
   * End the run. Cleans up and closes out log files.
   */
  void close();

  const char* uuid() const { return uuid_; }

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

  void createMetafile(const Encodable& meta);

  void createLogfile(dlf_stream_type_e t);

  char uuid_[37];
  fs::FS& fs_;
  char runDir_[128];
  char lockfilePath_[128];
  volatile dlf_file_state_e status_{UNINITIALIZED};
  SemaphoreHandle_t syncSemaphore_;
  std::chrono::microseconds tickInterval_;
  const std::vector<std::unique_ptr<dlf::datastream::AbstractStream>>& streams_;
  std::vector<std::unique_ptr<LogFile>> logFiles_;
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