"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dlf_meta_header_t = exports.dlf_event_stream_sample_t = exports.event_logfile_header_t = exports.event_stream_header_t = exports.polled_logfile_header_t = exports.polled_stream_header_t = exports.logfile_header_t = exports.stream_header_t = void 0;
const lightstruct_1 = require("lightstruct");
/** **/
const dlf_tick_t = lightstruct_1.uint64;
const dlf_time_us_t = lightstruct_1.uint32;
const dlf_stream_idx_t = lightstruct_1.uint16;
exports.stream_header_t = (0, lightstruct_1.struct)({
    type_id: (0, lightstruct_1.string)(128),
    id: (0, lightstruct_1.string)(32),
    notes: (0, lightstruct_1.string)(128),
    type_size: lightstruct_1.uint32,
});
exports.logfile_header_t = (0, lightstruct_1.struct)({
    magic: lightstruct_1.uint16,
    stream_type: lightstruct_1.uint8,
    tick_span: dlf_tick_t,
    num_streams: (0, lightstruct_1.referencedLength)(lightstruct_1.uint16),
});
/************ polled.dlf ************/
exports.polled_stream_header_t = (0, lightstruct_1.struct)({
    tick_interval: dlf_tick_t,
    tick_phase: dlf_tick_t,
}, exports.stream_header_t);
exports.polled_logfile_header_t = (0, lightstruct_1.struct)({
    streams: (0, lightstruct_1.array)(exports.polled_stream_header_t, s => s.num_streams)
}, exports.logfile_header_t);
/************ events.dlf ************/
exports.event_stream_header_t = exports.stream_header_t;
exports.event_logfile_header_t = (0, lightstruct_1.struct)({
    streams: (0, lightstruct_1.array)(exports.event_stream_header_t, s => s.num_streams)
}, exports.logfile_header_t);
exports.dlf_event_stream_sample_t = (0, lightstruct_1.struct)({
    stream: dlf_stream_idx_t,
    sample_tick: dlf_tick_t,
});
/********* meta.dlf *********/
exports.dlf_meta_header_t = (0, lightstruct_1.struct)({
    magic: lightstruct_1.uint16,
    tick_base_us: dlf_time_us_t,
    application: (0, lightstruct_1.string)(32),
    meta_size: lightstruct_1.uint32
});
