#pragma once

#include <Arduino.h>
#include <freertos/stream_buffer.h>

#include "AbstractStream.hpp"

namespace dlf::datastream {

/**
 * @brief Provides access to the stream of data underlying an AbstractStream
 *
 * Provides utilities for reading and encoding data at proper intervals into
 * the formats defined by concrete classes.
 */
class AbstractStreamHandle {
   protected:
    AbstractStream *stream;
    dlf_stream_idx_t idx;

    AbstractStreamHandle(AbstractStream *stream, dlf_stream_idx_t idx) : stream(stream), idx(idx) {}

   public:
    virtual bool available(dlf_tick_t tick) = 0;

    virtual size_t encode_into(StreamBufferHandle_t buf, dlf_tick_t tick) = 0;

    virtual size_t encode_header_into(StreamBufferHandle_t buf) {
        dlf_stream_header_t h{
            stream->src.type_structure,
            stream->id(),
            stream->notes(),
            stream->data_size(),
        };

        send(buf, h.type_structure);
        send(buf, h.id);
        send(buf, h.notes);
        send(buf, h.type_size);
        return 1;
    }

    template <typename T>
    size_t send(StreamBufferHandle_t buf, T data) {
        return xStreamBufferSend(buf, reinterpret_cast<uint8_t *>(&data), sizeof(T), portMAX_DELAY);
    }

    size_t send(StreamBufferHandle_t buf, const char *data) {
        if (data) {
            return xStreamBufferSend(buf, data, strlen(data) + 1, portMAX_DELAY);
        } else {
            return xStreamBufferSend(buf, "", strlen(""), portMAX_DELAY);
        }
    }
};

}  // namespace dlf::datastream

typedef std::unique_ptr<dlf::datastream::AbstractStreamHandle> stream_handle_t;
typedef std::vector<std::unique_ptr<dlf::datastream::AbstractStreamHandle>> stream_handles_t;
