#include "dlflib/datastream/event_stream_handle.h"

#include <fnv.h>

namespace dlf::datastream {

EventStreamHandle::EventStreamHandle(EventStream* stream, dlf_stream_idx_t idx)
    : AbstractStreamHandle(stream, idx) {}

inline size_t EventStreamHandle::currentHash() {
  return fnv_32_buf(stream->dataSource(), stream->dataSize(), FNV1_32_INIT);
}

// This called every tick. currentHash uses FNV to try to be efficient, but
// if perf is an issue look for alternatives.
bool EventStreamHandle::available(dlf_tick_t tick) {
  bool a = hash_ != currentHash();
#if defined(DEBUG) && defined(SILLY)
  DEBUG.printf(
      "\tCheck Event Data\n"
      "\t\tid: %s\n"
      "\t\tAvailable: %d\n",
      stream->id(), a);
#endif
  return a;
}

size_t EventStreamHandle::encodeHeaderInto(StreamBufferHandle_t buf) {
#ifdef DEBUG
  DEBUG.printf(
      "\tEncode Event Header\n"
      "\t\tidx: %d\n"
      "\t\ttype_structure: %s (hash: %x)\n"
      "\t\tid: %s\n"
      "\t\tnotes: %s\n",
      idx, stream->typeStructure(), stream->typeHash(), stream->id(),
      stream->notes());
#endif

  return AbstractStreamHandle::encodeHeaderInto(buf);
}

// FIXME: High possibility of overrunning streambuffer on initial tick (where
// all events are written) with lots of event data streams. Figure out how to
// mitigate!
size_t EventStreamHandle::encodeInto(StreamBufferHandle_t buf,
                                     dlf_tick_t tick) {
#ifdef DEBUG
  DEBUG.printf(
      "\tEncode Event Data\n"
      "\t\tid: %s\n",
      stream->id());
#endif
  size_t written = 0;

  if (stream->mutex()) {
    if (xSemaphoreTake(stream->mutex(), (TickType_t)10) != pdTRUE) {
      return 0;
    }
  }

  hash_ = currentHash();

  dlf_event_stream_sample_t h;
  h.stream = idx;
  h.sample_tick = tick;
  xStreamBufferSend(buf, &h, sizeof(h), 0);

  written = xStreamBufferSend(buf, stream->dataSource(), stream->dataSize(), 0);

  if (stream->mutex()) {
    xSemaphoreGive(stream->mutex());
  }

  return written;
}

}  // namespace dlf::datastream