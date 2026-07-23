#include "dlflib/datastream/polled_stream_handle.h"

#include "dlflib/log.h"

namespace dlf::datastream {

PolledStreamHandle::PolledStreamHandle(PolledStream* stream,
                                       dlf_stream_idx_t idx,
                                       dlf_tick_t sampleIntervalTicks,
                                       dlf_tick_t samplePhase)
    : AbstractStreamHandle(stream, idx),
      sampleIntervalTicks_(sampleIntervalTicks),
      samplePhaseTicks_(samplePhase),
      dataBuffer_(stream->dataSize()) {}

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

  if (stream->mutex()) {
    if (xSemaphoreTake(stream->mutex(), portMAX_DELAY) != pdTRUE) {
      DLFLIB_LOG_ERROR(
          "[PolledStreamHandle] Failed to acquire mutex for stream %s",
          stream->id());
      return 0;
    }
  }

  // Before calling xStreamBufferSend, copy the data out under the mutex
  // so we don't hold the mutex for longer than necessary.
  memcpy(dataBuffer_.data(), stream->dataSource(), dataBuffer_.size());

  if (stream->mutex()) {
    xSemaphoreGive(stream->mutex());
  }

  // Polled samples (unlike event samples) carry no per-sample framing, and thus
  // decoding relies entirely on every sample being written in full, in order.
  // xStreamBufferSend with a timeout of 0 can silently perform a partial write
  // when the buffer is nearly full, which would permanently desync byte
  // alignment for every sample downstream. So this must block until the full
  // sample can be written.
  return xStreamBufferSend(buf, dataBuffer_.data(), dataBuffer_.size(),
                           portMAX_DELAY);
}

}  // namespace dlf::datastream