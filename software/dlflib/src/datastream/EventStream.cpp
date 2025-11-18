#include "EventStream.hpp"

#include "EventStreamHandle.hpp"

using namespace dlf::datastream;

EventStream::EventStream(Encodable& dat, String id, const char* notes,
                         SemaphoreHandle_t mutex)
    : AbstractStream(dat, id, notes, mutex) {}

stream_handle_t EventStream::handle(microseconds tick_interval,
                                    dlf_stream_idx_t idx) {
  return std::unique_ptr<AbstractStreamHandle>(
      new EventStreamHandle(this, idx));
}

dlf_stream_type_e EventStream::type() { return EVENT; }
