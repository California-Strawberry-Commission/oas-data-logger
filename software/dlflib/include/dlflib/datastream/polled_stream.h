#pragma once

#include <memory>

#include "dlflib/datastream/abstract_stream.h"

namespace dlf::datastream {

/**
 * Concrete class representing metadata about a
 * stream of data that should be polled at some interval.
 */
class PolledStream : public AbstractStream {
 private:
  std::chrono::microseconds _sample_interval_us;
  std::chrono::microseconds _phase_us;

 public:
  PolledStream(Encodable& src, String id,
               std::chrono::microseconds sample_interval,
               std::chrono::microseconds phase, const char* notes,
               SemaphoreHandle_t mutex = NULL);

  stream_handle_t handle(std::chrono::microseconds tick_interval,
                         dlf_stream_idx_t idx);

  dlf_stream_type_e type();
};

}  // namespace dlf::datastream