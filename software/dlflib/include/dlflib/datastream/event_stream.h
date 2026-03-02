#pragma once

#include <memory>

#include "dlflib/datastream/abstract_stream.h"
#include "dlflib/dlf_encodable.h"

namespace dlf::datastream {

/**
 * Concrete class representing metadata about a
 * stream of data that should be polled at some interval.
 */
class EventStream : public AbstractStream {
 public:
  EventStream(const Encodable& dat, const char* id, const char* notes,
              SemaphoreHandle_t mutex = nullptr);

  std::unique_ptr<dlf::datastream::AbstractStreamHandle> createHandle(
      std::chrono::microseconds tickInterval, dlf_stream_idx_t idx);

  dlf_stream_type_e type();
};

}  // namespace dlf::datastream
