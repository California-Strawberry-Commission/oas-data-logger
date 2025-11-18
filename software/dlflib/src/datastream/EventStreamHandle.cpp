#include "EventStreamHandle.hpp"

extern "C"
{
// https://github.com/haipome/fnv/tree/master
#include <fnv.h>
}

using namespace dlf::datastream;

EventStreamHandle::EventStreamHandle(EventStream *stream, dlf_stream_idx_t idx) : AbstractStreamHandle(stream, idx)
{
}

inline size_t EventStreamHandle::current_hash()
{
    return fnv_32_buf(stream->data_source(), stream->data_size(), FNV1_32_INIT);
}

// This called every tick. current_hash uses FNV to try to be efficient, but
// if perf is an issue look for alternatives.
bool EventStreamHandle::available(dlf_tick_t tick)
{
    bool a = _hash != current_hash();
#if defined(DEBUG) && defined(SILLY)
    DEBUG.printf(
        "\tCheck Event Data\n"
        "\t\tid: %s\n"
        "\t\tAvailable: %d\n",
        stream->id(), a);
#endif
    return a;
}

size_t EventStreamHandle::encode_header_into(StreamBufferHandle_t buf)
{
#ifdef DEBUG
    DEBUG.printf(
        "\tEncode Event Header\n"
        "\t\tidx: %d\n"
        "\t\ttype_structure: %s (hash: %x)\n"
        "\t\tid: %s\n"
        "\t\tnotes: %s\n",
        idx, stream->src.type_structure, stream->src.type_hash, stream->id(), stream->notes());
#endif

    return AbstractStreamHandle::encode_header_into(buf);
}

// FIXME: High possibility of overrunning streambuffer on initial tick (where all events are written)
// with lots of event data streams. Figure out how to mitigate!
size_t EventStreamHandle::encode_into(StreamBufferHandle_t buf, dlf_tick_t tick)
{
#ifdef DEBUG
    DEBUG.printf(
        "\tEncode Event Data\n"
        "\t\tid: %s\n",
        stream->id());
#endif
    size_t written = 0;

    if (stream->_mutex)
    {
        if (xSemaphoreTake(stream->_mutex, (TickType_t)10) != pdTRUE)
        {
            return 0;
        }
    }

    _hash = current_hash();

    dlf_event_stream_sample_t h;
    h.stream = idx;
    h.sample_tick = tick;
    xStreamBufferSend(buf, &h, sizeof(h), 0);

    written = xStreamBufferSend(buf, stream->data_source(), stream->data_size(), 0);

    if (stream->_mutex)
    {
        xSemaphoreGive(stream->_mutex);
    }

    return written;
}