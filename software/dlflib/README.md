# DLFLib

A library for ESP32 (Arduino/FreeRTOS) that logs structured binary data to a filesystem using a custom format optimized for high-rate sensor data.

## Quick Start

```cpp
#include <SD_MMC.h>
#include <dlflib/dlf_logger.h>

dlf::DLFLogger logger{SD_MMC, "/"};

// Data variables. Must remain alive for the duration of logging
double temperature = 0.0;
uint32_t rpm = 0;
bool faultActive = false;

void setup() {
    SD_MMC.begin();

    using namespace std::chrono_literals;
    POLL(logger, temperature, 100ms); // sampled every 100 ms
    POLL(logger, rpm, 10ms); // sampled every 10 ms
    WATCH(logger, faultActive); // recorded only when value changes

    logger.begin();

    // Any Encodable value can be used as run metadata
    double meta = 1.0;
    dlf::run_handle_t run = logger.startRun(Encodable(meta, "double"));

    // When done:
    // logger.stopRun(run);
}
```

`POLL` registers a variable to be read at a fixed interval. `WATCH` registers a variable to be recorded only when its value changes. Both macros use the variable name as the stream ID.

## DLF File Format

### Overview

A run is stored as a directory with a UUID name containing three files:

```
/<root>/
└── <uuid>/
    ├── LOCK        Present while the run is active; removed on clean close.
    ├── meta.dlf    Run timestamp, tick base, and user-defined metadata.
    ├── polled.dlf  All polled streams, packed with no per-sample overhead.
    └── event.dlf   All event (watch) streams, one record per change.
```

### Design Goals

- **Metadata is stored with run data.**
- **Data is seekable.** Given only the file header, a byte offset can be calculated for any timestamp without scanning.
- **Minimal size.** No per-sample timestamps or delimiters in polled data. The tick system provides implicit timing.
- The storage layer can be considered reliable (this is subject to change).

### Tick / Time Base

Every run has a `tick_base_us`, which is the number of microseconds per tick. Each polled stream is sampled at a fixed `tick_interval` (in ticks). All stream intervals must be integer multiples of the tick base.

This integer-ratio system is what enables zero-overhead seeking. Given two streams with cycle intervals of 1 and 2, the pattern in the data section is fully deterministic:

```
Cycle 0: D1 D2
Cycle 1: D1
Cycle 2: D1 D2
Cycle 3: D1
...
```

Knowing each stream's `tick_interval` and `tick_phase`, the byte offset of any sample can be computed from the file header alone.

Wall time can be calculated as `time_us = tick * tick_base_us`.

---

### `meta.dlf`

| Field            | Type                | Notes                                |
| ---------------- | ------------------- | ------------------------------------ |
| `magic`          | `uint16`            | Always `0x8414`. Reveals byte order. |
| `epoch_time_s`   | `uint32`            | Unix time at run start.              |
| `tick_base_us`   | `uint32`            | Microseconds per tick.               |
| `meta_structure` | null-terminated str | Type descriptor (see below).         |
| `meta_size`      | `uint32`            | Byte length of the metadata blob.    |
| _(metadata)_     | `uint8[]`           | Raw metadata, `meta_size` bytes.     |

**`meta_structure` format:**

- Single primitive: `"double"`, `"uint32_t"`, etc.
- Packed struct: `"TypeName;field1:type1:byteOffset1;field2:type2:byteOffset2"`
  - The offset is the byte position in the buffer to start reading the value from. The offset is relative, so the first field should have an offset of 0.
- Opaque / no parser: prefix with `"!"`

---

### `polled.dlf` and `event.dlf`

Both files share the same header structure, differing only in `stream_type`.

**File header:**

| Field         | Type     | Notes                                 |
| ------------- | -------- | ------------------------------------- |
| `magic`       | `uint16` | `0x8414`                              |
| `stream_type` | `uint8`  | `0` = polled, `1` = event             |
| `tick_span`   | `uint64` | Total ticks the file covers.          |
| `num_streams` | `uint16` | Number of stream headers that follow. |

**Per-stream header** (repeated `num_streams` times):

| Field            | Type                | Notes                                        |
| ---------------- | ------------------- | -------------------------------------------- |
| `type_structure` | null-terminated str | Same format as `meta_structure`.             |
| `id`             | null-terminated str | Unique stream identifier.                    |
| `notes`          | null-terminated str | Optional notes string (may be empty).        |
| `type_size`      | `uint32`            | Byte size of one sample value.               |
| `tick_interval`  | `uint64`            | _(polled only)_ Sampling period in ticks.    |
| `tick_phase`     | `uint64`            | _(polled only)_ Tick offset of first sample. |

**Data section - polled:**

Raw samples packed sequentially in tick order, with no separators or timestamps. Within each tick, streams are written in header order. A stream contributes a sample at tick `t` when `(t - tick_phase) % tick_interval == 0`. The header provides everything needed to calculate byte offsets.

**Data section - event:**

One record per detected change (based on an FNV hash comparison at each tick):

| Field         | Type      | Notes                                  |
| ------------- | --------- | -------------------------------------- |
| `stream`      | `uint16`  | Index into the stream header array.    |
| `sample_tick` | `uint64`  | Tick at which the change was detected. |
| _(data)_      | `uint8[]` | Raw value, `type_size` bytes.          |

---

### Endianness

All values are little-endian. The magic `0x8414` is stored on disk as bytes `[0x14, 0x84]`.

Full struct definitions: [`include/dlflib/dlf_types.h`](include/dlflib/dlf_types.h)

## Code Structure

```
Logger
└── Run[]
    └── LogFile[]  (one per stream type: polled, event)
        └── StreamHandle[]
```

### `Logger`

The user-facing class. Holds the stream registrations (`poll()`/`watch()` calls) and optional components (e.g. `UploaderComponent`). Stream registrations are shared across all runs.

`startRun()` returns a `run_handle_t`. The active `Run` object can be retrieved via `getRun(handle)` if direct access is needed, but most use cases only need `stopRun(handle)`.

### `Run`

Created by `startRun()`. Picks a UUID, creates the run directory and `LOCK` file, instantiates `LogFile`s, and drives the tick loop, a FreeRTOS task that fires at `tick_base_us` intervals and triggers sampling on each `LogFile`. On `stopRun()`, it flushes all log files, removes the `LOCK` file, and signals `RUN_COMPLETE`.

### `LogFile`

One instance per stream type (`POLLED` or `EVENT`). Writes the binary file header on open, then accepts samples from the tick loop into an internal buffer. A background flusher task drains the buffer to the SD card in block-aligned writes.

### `StreamHandle`

Created fresh for each run from the registered stream objects. Tracks when a stream is due to fire based on its `tick_interval` and `tick_phase`, copies the current value from the source variable, and writes the raw bytes into the owning `LogFile`'s buffer. For event streams, compares an FNV hash of the current value against the previous tick to detect changes.
