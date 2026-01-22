#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <chrono>
#include <vector>

#include "dlflib/components/dlf_component.h"
#include "dlflib/components/uploader_component.h"
#include "dlflib/datastream/event_stream.h"
#include "dlflib/datastream/polled_stream.h"
#include "dlflib/dlf_logfile.h"
#include "dlflib/dlf_run.h"
#include "dlflib/dlf_types.h"

#define POLL(type_name)                                                        \
  DLFLogger& poll(                                                             \
      type_name& value, String id, std::chrono::microseconds sampleInterval,   \
      std::chrono::microseconds phase = std::chrono::microseconds::zero(),     \
      const char* notes = nullptr, SemaphoreHandle_t mutex = NULL) {           \
    return pollInternal(Encodable(value, #type_name), id, sampleInterval,      \
                        phase, notes, mutex);                                  \
  }                                                                            \
  DLFLogger& poll(type_name& value, String id,                                 \
                  std::chrono::microseconds sampleInterval, const char* notes, \
                  SemaphoreHandle_t mutex = NULL) {                            \
    return pollInternal(Encodable(value, #type_name), id, sampleInterval,      \
                        std::chrono::microseconds::zero(), notes, mutex);      \
  }                                                                            \
  DLFLogger& poll(type_name& value, String id,                                 \
                  std::chrono::microseconds sampleInterval,                    \
                  SemaphoreHandle_t mutex) {                                   \
    return pollInternal(Encodable(value, #type_name), id, sampleInterval,      \
                        std::chrono::microseconds::zero(), nullptr, mutex);    \
  }

#define WATCH(type_name)                                                     \
  DLFLogger& watch(type_name& value, String id, const char* notes = nullptr, \
                   SemaphoreHandle_t mutex = NULL) {                         \
    return watchInternal(Encodable(value, #type_name), id, notes, mutex);    \
  }

#define MAX_RUNS 1

namespace dlf {

// 0 is error, > 0 is valid handle
using run_handle_t = int;

class DLFLogger : public dlf::components::DlfComponent {
 public:
  enum LoggerEvents : uint32_t { NEW_RUN = 1 };

  DLFLogger(fs::FS& fs, String fsDir = "/");

  bool begin();

  run_handle_t startRun(Encodable meta, std::chrono::microseconds tickRate =
                                            std::chrono::milliseconds(100));

  void stopRun(run_handle_t h);

  WATCH(uint8_t)
  WATCH(uint16_t)
  WATCH(uint32_t)
  WATCH(uint64_t)
  WATCH(int8_t)
  WATCH(int16_t)
  WATCH(int32_t)
  WATCH(int64_t)
  WATCH(bool)
  WATCH(double)
  WATCH(float)

  POLL(uint8_t)
  POLL(uint16_t)
  POLL(uint32_t)
  POLL(uint64_t)
  POLL(int8_t)
  POLL(int16_t)
  POLL(int32_t)
  POLL(int64_t)
  POLL(bool)
  POLL(double)
  POLL(float)

  DLFLogger& syncTo(const String& endpoint, const String& deviceUid,
                    const dlf::components::UploaderComponent::Options& options);

  DLFLogger& syncTo(const String& endpoint, const String& deviceUid,
                    const String& secret,
                    const dlf::components::UploaderComponent::Options& options);

  void waitForSyncCompletion();

  EventBits_t waitForNewRun(TickType_t ticksToWait = portMAX_DELAY) {
    return xEventGroupWaitBits(loggerEventGroup_, NEW_RUN, pdTRUE, pdTRUE,
                               ticksToWait);
  }

  std::vector<run_handle_t> getActiveRuns();

  Run* getRun(run_handle_t h);

 private:
  DLFLogger& watchInternal(Encodable value, String id, const char* notes,
                           SemaphoreHandle_t mutex = NULL);

  DLFLogger& pollInternal(Encodable value, String id,
                          std::chrono::microseconds sampleInterval,
                          std::chrono::microseconds phase, const char* notes,
                          SemaphoreHandle_t mutex = NULL);

  run_handle_t getAvailableHandle();

  void prune();

  std::unique_ptr<Run> runs_[MAX_RUNS];
  // Todo: Figure out how to do this with unique_ptrs
  dlf::datastream::streams_t streams_;
  fs::FS& fs_;
  String fsDir_;
  std::vector<dlf::components::DlfComponent*> components_;
  // Used to signal that a new run is available
  EventGroupHandle_t loggerEventGroup_{nullptr};
};

}  // namespace dlf

#undef POLL
#undef WATCH

#define WATCH(logger, value, ...) logger.watch(value, #value, ##__VA_ARGS__)
#define POLL(logger, value, ...) logger.poll(value, #value, ##__VA_ARGS__)