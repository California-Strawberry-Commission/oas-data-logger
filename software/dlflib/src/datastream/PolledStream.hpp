#pragma once

#include <memory>

#include "AbstractStream.hpp"

namespace dlf::datastream {

/**
 * Concrete class representing metadata about a
 * stream of data that should be polled at some interval.
 */
class PolledStream : public AbstractStream {
   private:
    microseconds _sample_interval_us;
    microseconds _phase_us;

   public:
    PolledStream(Encodable &src, String id, microseconds sample_interval, microseconds phase, const char* notes, SemaphoreHandle_t mutex = NULL);

    stream_handle_t handle(microseconds tick_interval, dlf_stream_idx_t idx);

    dlf_stream_type_e type();
};
}  // namespace dlf::datastream