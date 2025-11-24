#pragma once

#include "dlflib/datastream/abstract_stream_handle.h"
#include "dlflib/datastream/event_stream.h"

namespace dlf::datastream {

class EventStreamHandle : public AbstractStreamHandle {
 public:
  EventStreamHandle(EventStream* stream, dlf_stream_idx_t idx);

  bool available(dlf_tick_t tick);

  size_t encodeHeaderInto(StreamBufferHandle_t buf);

  size_t encodeInto(StreamBufferHandle_t buf, dlf_tick_t tick);

 private:
  inline size_t currentHash();

  size_t hash_ = 0;
};

}  // namespace dlf::datastream
