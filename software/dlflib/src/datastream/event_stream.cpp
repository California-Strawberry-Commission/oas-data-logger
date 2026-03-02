#include "dlflib/datastream/event_stream.h"

#include "dlflib/datastream/event_stream_handle.h"

namespace dlf::datastream {

EventStream::EventStream(const Encodable& dat, const char* id,
                         const char* notes, SemaphoreHandle_t mutex)
    : AbstractStream(dat, id, notes, mutex) {}

std::unique_ptr<dlf::datastream::AbstractStreamHandle>
EventStream::createHandle(std::chrono::microseconds tickInterval,
                          dlf_stream_idx_t idx) {
  return dlf::util::make_unique<EventStreamHandle>(this, idx);
}

dlf_stream_type_e EventStream::type() { return EVENT; }

}  // namespace dlf::datastream