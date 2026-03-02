#pragma once

#include <Arduino.h>
#include <freertos/semphr.h>

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
  virtual std::unique_ptr<AbstractStreamHandle> createHandle(
      std::chrono::microseconds tickInterval, dlf_stream_idx_t idx) = 0;

  virtual dlf_stream_type_e type() = 0;

  size_t dataSize() { return src_.dataSize; }

  const uint8_t* dataSource() { return src_.data; }

  const char* typeStructure() { return src_.typeStructure; }

  size_t typeHash() { return src_.typeHash; }

  const char* notes() { return notes_ != nullptr ? notes_ : "N/A"; }

  const char* id() { return id_; }

  SemaphoreHandle_t mutex() const { return mutex_; }

 protected:
  AbstractStream(const Encodable& dat, const char* id, const char* notes,
                 SemaphoreHandle_t mutex)
      : src_(dat), mutex_(mutex) {
    snprintf(id_, sizeof(id_), "%s", id ? id : "");
    snprintf(notes_, sizeof(notes_), "%s", notes ? notes : "");
  }

 private:
  const Encodable src_;
  char id_[32];
  char notes_[128];
  SemaphoreHandle_t mutex_;
};

}  // namespace dlf::datastream
