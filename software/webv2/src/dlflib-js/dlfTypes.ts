import { _minSize, array, debugType, jsType, string, struct, uint16, uint32, uint64, uint8 } from "lightstruct"

/** **/
const dlf_tick_t = uint64;
const dlf_time_us_t = uint32;
const dlf_stream_idx_t = uint16;


/************ polled.dlf ************/
export const polled_stream_header_t = struct({
    type_id: string(128),
    id: string(32),
    notes: string(128),
    type_size: uint32,
    tick_interval: dlf_tick_t,
    tick_phase: dlf_tick_t,
});
export type polled_stream_header_jst = jsType<typeof polled_stream_header_t>

export const polled_logfile_header_t = struct({
    magic: uint16,
    stream_type: uint8,
    tick_span: dlf_tick_t,

    num_streams: uint16,
    streams: array(polled_stream_header_t, "num_streams")
});
export type polled_logfile_header_jst = jsType<typeof polled_logfile_header_t>

/************ events.dlf ************/
export const event_stream_header_t = struct({
    type_id: string(128),
    id: string(32),
    notes: string(128),
    type_size: uint32,
});
export type event_stream_header_jst = jsType<typeof event_stream_header_t>

export const event_logfile_header_t = struct({
    magic: uint16,
    stream_type: uint8,
    tick_span: dlf_tick_t,

    num_streams: uint16,
    streams: array(event_stream_header_t, "num_streams")
});
export type event_logfile_header_jst = jsType<typeof event_logfile_header_t>

export const dlf_event_stream_sample_t = struct({
    stream: dlf_stream_idx_t,
    sample_tick: dlf_tick_t,
});

/********* meta.dlf *********/
export const dlf_meta_header_t = struct({
    magic: uint16,
    tick_base_us: dlf_time_us_t,
    application: string(32),

    meta_size: uint32
});
export type dlf_meta_header_jst = jsType<typeof dlf_meta_header_t>
