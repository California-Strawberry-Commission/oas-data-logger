#include "dlflib/datastream/polled_stream_handle.h"

#include "dlflib/log.h"

namespace dlf::datastream {

PolledStreamHandle::PolledStreamHandle(PolledStream* stream,
                                       dlf_stream_idx_t idx,
                                       dlf_tick_t sampleIntervalTicks,
                                       dlf_tick_t samplePhase)
    : AbstractStreamHandle(stream, idx),
      sampleIntervalTicks_(sampleIntervalTicks),
      samplePhaseTicks_(samplePhase) {}

// This called every tick to determine whether we need to write new data
bool PolledStreamHandle::available(dlf_tick_t tick) {
  return sampleIntervalTicks_ == 0 ||
         ((tick + samplePhaseTicks_) % sampleIntervalTicks_) == 0;
}

size_t PolledStreamHandle::encodeHeaderInto(StreamBufferHandle_t buf) {
#ifdef DEBUG
  DLFLIB_LOG_DEBUG(
      "[PolledStreamHandle] Encode polled header:\n"
      "\tidx: %d\n"
      "\ttype_structure: %s (hash: %x)\n"
      "\tid: %s\n"
      "\tnotes: %s\n"
      "\ttick_interval: %llu\n"
      "\ttick_phase: %llu",
      idx, stream->typeStructure(), stream->typeHash(), stream->id(),
      stream->notes(), sampleIntervalTicks_, samplePhaseTicks_);
#endif

  AbstractStreamHandle::encodeHeaderInto(buf);

  dlf_polled_stream_header_segment_t h{
      sampleIntervalTicks_,
      samplePhaseTicks_,
  };

  return send(buf, h);
}

size_t PolledStreamHandle::encodeInto(StreamBufferHandle_t buf,
                                      dlf_tick_t tick) {
#ifdef DEBUG
  DLFLIB_LOG_DEBUG(
      "[PolledStreamHandle] Encode polled data:\n"
      "\tid: %s",
      stream->id());
#endif

  size_t written = 0;

  if (stream->mutex()) {
    if (xSemaphoreTake(stream->mutex(), (TickType_t)10) != pdTRUE) {
      return 0;
    }
  }

  written = xStreamBufferSend(buf, stream->dataSource(), stream->dataSize(), 0);

  if (stream->mutex()) {
    xSemaphoreGive(stream->mutex());
  }
  return written;
}

}  // namespace dlf::datastream