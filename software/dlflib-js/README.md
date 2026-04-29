# dlflib-js

TypeScript library for reading DLF run files. See [dlflib/README.md](../dlflib/README.md) for the file format specification.

## Usage

Extend `Adapter` with three properties that return the raw bytes of each file in a run directory, then call the parsing methods:

```typescript
import { Adapter } from "dlflib-js";

class MyAdapter extends Adapter {
  get meta_dlf() {
    /* return Promise<Uint8Array> */
  }
  get polled_dlf() {
    /* return Promise<Uint8Array> */
  }
  get events_dlf() {
    /* return Promise<Uint8Array> */
  }
}

const run = new MyAdapter();

const header = await run.meta_header(); // { magic, epoch_time_s, tick_base_us, ... }
const meta = await run.meta(); // parsed metadata blob

const polled = await run.polled_data(); // [{ stream, data, tick, offset }, ...]
const events = await run.events_data(); // [{ stream, stream_idx, tick, data }, ...]
```

`polled_data(startTick?, endTick?)` accepts optional tick bounds for windowed reads.

A filesystem-backed implementation is available in `src/fsadapter.ts`.
