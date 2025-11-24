#pragma once

#include "dlflib/datastream/abstract_stream_handle.h"
#include "dlflib/datastream/event_stream.h"

namespace dlf::datastream {
class EventStreamHandle : public AbstractStreamHandle {
  size_t _hash = 0;

 public:
  EventStreamHandle(EventStream* stream, dlf_stream_idx_t idx);

  inline size_t current_hash();

  bool available(dlf_tick_t tick);

  size_t encode_header_into(StreamBufferHandle_t buf);

  size_t encode_into(StreamBufferHandle_t buf, dlf_tick_t tick);
};
}  // namespace dlf::datastream
