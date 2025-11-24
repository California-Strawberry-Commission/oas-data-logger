#pragma once

#include <Arduino.h>
#include <freertos/semphr.h>
#include <string.h>

#include <chrono>
#include <memory>
#include <vector>

#include "dlflib/dlf_encodable.h"
#include "dlflib/dlf_types.h"
#include "dlflib/util/util.h"

namespace dlf::datastream {

inline const char* streamTypeToString(dlf_stream_type_e t) {
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
 public:
  /**
   * @brief Creates a new, linked StreamHandle
   * @param tickInterval
   * @param idx
   * @return
   */
  virtual std::unique_ptr<AbstractStreamHandle> handle(
      std::chrono::microseconds tickInterval, dlf_stream_idx_t idx) = 0;

  virtual dlf_stream_type_e type() = 0;

  inline size_t dataSize() { return src_.data_size; }

  inline const uint8_t* dataSource() { return src_.data; }

  inline const char* typeStructure() { return src_.type_structure; }

  inline size_t typeHash() { return src_.type_hash; }

  inline const char* notes() { return notes_ != nullptr ? notes_ : "N/A"; }

  inline const char* id() { return id_.c_str(); }

  inline SemaphoreHandle_t mutex() const { return mutex_; }

 protected:
  AbstractStream(Encodable& dat, String id, const char* notes,
                 SemaphoreHandle_t mutex)
      : src_(dat), id_(id), notes_(notes), mutex_(mutex) {}

 private:
  const Encodable src_;
  const String id_;
  const char* notes_;
  SemaphoreHandle_t mutex_;
};

using streams_t = std::vector<AbstractStream*>;

}  // namespace dlf::datastream
