#include "dlflib/datastream/polled_stream_handle.h"

namespace dlf::datastream {

PolledStreamHandle::PolledStreamHandle(PolledStream* stream,
                                       dlf_stream_idx_t idx,
                                       dlf_tick_t sampleIntervalTicks,
                                       dlf_tick_t samplePhase)
    : AbstractStreamHandle(stream, idx),
      sampleIntervalTicks_(sampleIntervalTicks),
      samplePhaseTicks_(samplePhase) {}

bool PolledStreamHandle::available(dlf_tick_t tick) {
  bool a = sampleIntervalTicks_ == 0 ||
           ((tick + samplePhaseTicks_) % sampleIntervalTicks_) == 0;

#if defined(DEBUG) && defined(SILLY)
  DEBUG.printf(
      "\tCheck Polled Data\n"
      "\t\tid: %s\n"
      "\t\tAvailable: %d\n",
      stream->id(), a);
#endif
  return a;
}

size_t PolledStreamHandle::encodeHeaderInto(StreamBufferHandle_t buf) {
#ifdef DEBUG
  DEBUG.printf(
      "\tEncode Polled Header\n"
      "\t\tidx: %d\n"
      "\t\ttype_structure: %s (hash: %x)\n"
      "\t\tid: %s\n"
      "\t\tnotes: %s\n"
      "\t\ttick_interval: %llu\n"
      "\t\ttick_phase: %llu\n",
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
  DEBUG.printf(
      "\tEncode Polled Data\n"
      "\t\tid: %s\n",
      stream->id());
#endif
  // Sample data
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