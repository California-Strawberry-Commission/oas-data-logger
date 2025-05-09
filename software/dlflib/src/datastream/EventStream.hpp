#pragma once

#include <memory>

#include "AbstractStream.hpp"
#include "dlf_encodable.h"

using std::chrono::microseconds;

namespace dlf::datastream {

/**
 * Concrete class representing metadata about a
 * stream of data that should be polled at some interval.
 */
class EventStream : public AbstractStream {
   public:
    EventStream(Encodable &dat, String id, const char* notes);

    stream_handle_t handle(microseconds tick_interval, dlf_stream_idx_t idx);

    dlf_stream_type_e type();
};
}  // namespace dlf::datastream
