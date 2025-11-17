#include "PolledStreamHandle.hpp"

using namespace dlf::datastream;

PolledStreamHandle::PolledStreamHandle(PolledStream *stream, dlf_stream_idx_t idx, dlf_tick_t sample_interval_ticks, dlf_tick_t sample_phase)
    : AbstractStreamHandle(stream, idx), _sample_interval_ticks(sample_interval_ticks), _sample_phase_ticks(sample_phase) {
}

bool PolledStreamHandle::available(dlf_tick_t tick) {
    bool a = _sample_interval_ticks == 0 || ((tick + _sample_phase_ticks) % _sample_interval_ticks) == 0;

#if defined(DEBUG) && defined(SILLY)
    DEBUG.printf(
        "\tCheck Polled Data\n"
        "\t\tid: %s\n"
        "\t\tAvailable: %d\n",
        stream->id(), a);
#endif
    return a;
}

size_t PolledStreamHandle::encode_header_into(StreamBufferHandle_t buf) {
#ifdef DEBUG
    DEBUG.printf(
        "\tEncode Polled Header\n"
        "\t\tidx: %d\n"
        "\t\ttype_structure: %s (hash: %x)\n"
        "\t\tid: %s\n"
        "\t\tnotes: %s\n"
        "\t\ttick_interval: %llu\n"
        "\t\ttick_phase: %llu\n",
        idx, stream->src.type_structure, stream->src.type_hash, stream->id(), stream->notes(), _sample_interval_ticks, _sample_phase_ticks);
#endif

    AbstractStreamHandle::encode_header_into(buf);

    dlf_polled_stream_header_segment_t h{
        _sample_interval_ticks,
        _sample_phase_ticks,
    };

    return send(buf, h);
}

size_t PolledStreamHandle::encode_into(StreamBufferHandle_t buf, dlf_tick_t tick) {
#ifdef DEBUG
    DEBUG.printf(
        "\tEncode Polled Data\n"
        "\t\tid: %s\n",
        stream->id());
#endif
    // Sample data
    size_t written = 0;

    if(stream->_mutex){
        if (xSemaphoreTake(stream->_mutex, (TickType_t)10) != pdTRUE){
            return 0;
        }
    }

    written = xStreamBufferSend(buf, stream->data_source(), stream->data_size(), 0);

    if(stream->_mutex){
        xSemaphoreGive(stream->_mutex);
    }
    return written;
}