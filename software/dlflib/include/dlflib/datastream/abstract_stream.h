#pragma once

#include <Arduino.h>
#include <freertos/semphr.h>
#include <string.h>

#include <chrono>
#include <memory>
#include <vector>

#include "dlflib/dlf_cfg.h"
#include "dlflib/dlf_encodable.h"
#include "dlflib/dlf_types.h"
#include "dlflib/util/util.h"

namespace dlf::datastream {

inline const char* stream_type_to_string(dlf_stream_type_e t) {
  switch (t) {
    case POLLED:
      return "polled";
    case EVENT:
      return "event";
    default:
      return "PROBLEM";
  }
}

// Forward declare abstract_stream_handle.h
class AbstractStreamHandle;
using stream_handle_t = std::unique_ptr<AbstractStreamHandle>;

/**
 * Abstract class representing a source of data as well as some information
 * (name, typeID) about it.
 */
class AbstractStream {
 private:
  const char* _notes;
  const String _id;

 protected:
  AbstractStream(Encodable& dat, String id, const char* notes,
                 SemaphoreHandle_t mutex)
      : _notes(notes), _id(id), src(dat), _mutex(mutex) {}

 public:
  SemaphoreHandle_t _mutex;
  const Encodable src;

  /**
   * @brief Creates a new, linked StreamHandle
   * @param tick_interval
   * @param idx
   * @return
   */
  virtual std::unique_ptr<AbstractStreamHandle> handle(
      std::chrono::microseconds tick_interval, dlf_stream_idx_t idx) = 0;

  virtual dlf_stream_type_e type() = 0;

  inline size_t data_size() { return src.data_size; }

  inline const uint8_t* data_source() { return src.data; }

  inline const char* notes() {
    if (_notes != nullptr) return _notes;
    return "N/A";
  }

  inline const char* id() { return _id.c_str(); }
};

using streams_t = std::vector<AbstractStream*>;

}  // namespace dlf::datastream
