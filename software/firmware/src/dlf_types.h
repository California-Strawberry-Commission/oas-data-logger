#pragma once
#include <Arduino.h>
#include <FS.h>

#include <vector>

#include "dlf_util.h"

#define HEADER_VERSION 0

#define DLF_MAGIC 0x8414

typedef uint64_t dlf_tick_t;
typedef uint32_t dlf_time_us_t;
typedef uint16_t dlf_stream_idx_t;

enum dlf_file_state_e : int8_t {
    // Errors are (-)
    FILE_OPEN_ERROR = -7,
    SYNC_CREATE_ERROR = -6,
    STREAM_CREATE_ERROR = -5,
    FLUSHER_CREATE_ERROR = -4,
    QUEUE_FULL = -3,
    HEAP_FULL = -2,
    INIT_ERROR = -1,

    UNINITIALIZED = 0,
    INITIALIZED = 1,
    LOGGING = 2,
    FLUSHING = 3,
    FLUSHED = 4,
    CLOSED = 5,
};

enum dlf_stream_type_e : uint8_t {
    POLLED,
    EVENT
};

/* Overall Header Definition (meta.dlf) */
struct dlf_meta_header_t {
    uint16_t magic = DLF_MAGIC;  // IDs DLF files. Also allows auto-detection of LSB/MSB encoding.
    dlf_time_us_t tick_base_us;  // Base time interval, in us. Limits how fast samples will be stored.
    const char* meta_structure;        // Structure of metadata struct.
    uint32_t meta_size;          // Metadata size stored in case there is no metadata parser available

    // Next: Metadata
} __attribute__((packed));

/* Logfile Stream Definitions */
struct dlf_logfile_header_t {
    uint16_t magic = DLF_MAGIC;  // IDs DLF files. Also allows auto-detection of LSB/MSB encoding.
    dlf_stream_type_e stream_type;
    dlf_tick_t tick_span;  // Total number of ticks this file spans.

    uint16_t num_streams;
    // Next: Array of dlf_polled_stream_header_segment_t OR dlf_event_stream_header_t
} __attribute__((packed));

/* Stream Header Definitions (polled.dlf, events.dlf) */
struct dlf_stream_header_t {
    const char* type_structure;  // das
    const char* id;              // Unique identifier for this specific stream
    const char* notes;           // Anything that needs to be communicated about this data stream.
    uint32_t type_size;          // Records the size of this type to allow parsing even when parser is not found.
} __attribute__((packed));

struct dlf_polled_stream_header_segment_t {
    dlf_tick_t tick_interval;  // Interval on which this stream is collected.
    dlf_tick_t tick_phase;     // Tick offset defining when this stream starts
} __attribute__((packed));

// struct dlf_event_stream_header_t
// {
// } __attribute__((packed));
/* Event Stream Sample Definitions */
struct dlf_event_stream_sample_t {
    dlf_stream_idx_t stream;
    dlf_tick_t sample_tick;
    // Next: raw data
} __attribute__((packed));

// enum fs_db_operation : uint8_t
// {
//     CREATE,
//     DELETE,
// }

// struct fs_db_entry
// {
//     char *key;
//     fs_db_operation op;
//     uint16_t meta_size;
//     uint8_t *meta;
// } __attribute__((packed));
