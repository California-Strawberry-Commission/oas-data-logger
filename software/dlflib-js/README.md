# dlflib-js

TypeScript library for reading and writing DLF run files. See [dlflib/README.md](../dlflib/README.md) for the file format specification.

## Usage

### Reading

Extend `Adapter` with three getters that return the raw bytes of each file in a run directory, then call the parsing methods:

```typescript
import { Adapter } from "dlflib-js";

class MyAdapter extends Adapter {
  get metaDlfBytes() { /* return Promise<Uint8Array> */ }
  get polledDlfBytes() { /* return Promise<Uint8Array> */ }
  get eventDlfBytes() { /* return Promise<Uint8Array> */ }
}

const run = new MyAdapter();

const metaDlf = await run.getMetaDlf();  // ParsedMetaDlf
const meta = await run.getMeta();  // decoded metadata blob

const polledDlf = await run.getPolledDlf(); // ParsedDataDlf
const polled = await run.getPolledData(startTick?, endTick?); // [{ stream, data, tick, offset }, ...]

const eventDlf = await run.getEventDlf();  // ParsedDataDlf
const events = await run.getEventData();  // [{ stream, streamIdx, tick, data }, ...]
```

`getPolledData(startTick?, endTick?)` accepts optional `bigint` tick bounds for windowed reads.

A filesystem-backed implementation is available in `src/fsadapter.ts`.

### Writing

```typescript
import { encodeMeta, encodePolled, encodeEvent } from "dlflib-js";
import type { MetaDlf, PolledDlf, EventDlf } from "dlflib-js";

const metaBytes = encodeMeta(metaObj); // MetaDlf -> Uint8Array
const polledBytes = encodePolled(polledObj); // PolledDlf -> Uint8Array
const eventBytes = encodeEvent(eventObj); // EventDlf -> Uint8Array
```
