#include "dlflib/datastream/polled_stream.h"

#include "dlflib/datastream/polled_stream_handle.h"

namespace dlf::datastream {

PolledStream::PolledStream(Encodable& src, String id,
                           std::chrono::microseconds sampleInterval,
                           std::chrono::microseconds phase, const char* notes,
                           SemaphoreHandle_t mutex)
    : AbstractStream(src, id, notes, mutex),
      sampleInterval_(sampleInterval),
      phase_(phase) {}

stream_handle_t PolledStream::handle(std::chrono::microseconds tickInterval,
                                     dlf_stream_idx_t idx) {
  dlf_tick_t sampleIntervalTicks = 0;
  dlf_tick_t samplePhaseTicks = 0;

  // These will throw div/0 if a 0 sample interval (every tick) is given.
  if (sampleInterval_ != std::chrono::microseconds::zero()) {
    sampleIntervalTicks = max(sampleInterval_ / tickInterval, 1ll);
    samplePhaseTicks = phase_ / tickInterval;
  }

  return std::unique_ptr<AbstractStreamHandle>(
      new PolledStreamHandle(this, idx, sampleIntervalTicks, samplePhaseTicks));
}

dlf_stream_type_e PolledStream::type() { return POLLED; }

}  // namespace dlf::datastream