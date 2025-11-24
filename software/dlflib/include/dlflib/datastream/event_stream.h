#pragma once

#include <memory>

#include "dlflib/datastream/abstract_stream.h"
#include "dlflib/dlf_encodable.h"

using std::chrono::microseconds;

namespace dlf::datastream {

/**
 * Concrete class representing metadata about a
 * stream of data that should be polled at some interval.
 */
class EventStream : public AbstractStream {
 public:
  EventStream(Encodable& dat, String id, const char* notes,
              SemaphoreHandle_t mutex = NULL);
  stream_handle_t handle(microseconds tick_interval, dlf_stream_idx_t idx);

  dlf_stream_type_e type();
};
}  // namespace dlf::datastream
