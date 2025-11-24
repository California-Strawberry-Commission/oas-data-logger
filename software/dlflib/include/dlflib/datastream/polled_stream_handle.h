#pragma once

#include <memory>

#include "dlflib/datastream/abstract_stream_handle.h"
#include "dlflib/datastream/polled_stream.h"

namespace dlf::datastream {

class PolledStreamHandle : public AbstractStreamHandle {
  dlf_tick_t _sample_interval_ticks;
  dlf_tick_t _sample_phase_ticks;

 public:
  PolledStreamHandle(PolledStream* stream, dlf_stream_idx_t idx,
                     dlf_tick_t sample_interval_ticks, dlf_tick_t sample_phase);

  bool available(dlf_tick_t tick);

  size_t encode_header_into(StreamBufferHandle_t buf);

  size_t encode_into(StreamBufferHandle_t buf, dlf_tick_t tick);
};

}  // namespace dlf::datastream