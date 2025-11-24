#pragma once

#include <memory>

#include "dlflib/datastream/abstract_stream_handle.h"
#include "dlflib/datastream/polled_stream.h"

namespace dlf::datastream {

class PolledStreamHandle : public AbstractStreamHandle {
 public:
  PolledStreamHandle(PolledStream* stream, dlf_stream_idx_t idx,
                     dlf_tick_t sampleIntervalTicks, dlf_tick_t samplePhase);

  bool available(dlf_tick_t tick);

  size_t encodeHeaderInto(StreamBufferHandle_t buf);

  size_t encodeInto(StreamBufferHandle_t buf, dlf_tick_t tick);

 private:
  dlf_tick_t sampleIntervalTicks_;
  dlf_tick_t samplePhaseTicks_;
};

}  // namespace dlf::datastream