import * as fs from "fs";
import * as path from "path";
import process from "process";
import { expect, test } from "vitest";
import { 
  Adapter, TEventLogObj, TPolledLogObj, TMetaObj, 
  encode_meta, encode_polled, encode_events 
} from "../src/dlflib.js";

class LocalFileAdapter extends Adapter {
  constructor(private filePath: string) { super(); }
  get polled_dlf() { return fs.promises.readFile(this.filePath); }
  get events_dlf() { return fs.promises.readFile(this.filePath); }
  get meta_dlf() { return fs.promises.readFile(this.filePath); }
}

// Helper functions

async function assembleMeta(adapter: Adapter): Promise<TMetaObj> {
  const [header, data] = await Promise.all([adapter.meta_header(), adapter.meta()]);
  return {
    magic: header.magic,
    epoch_time_s: header.epoch_time_s,
    tick_base_us: header.tick_base_us,
    meta_structure: header.meta_structure,
    meta: data,
  };
}

async function assemblePolled(adapter: Adapter): Promise<TPolledLogObj> {
  const [header, data] = await Promise.all([adapter.polled_header(), adapter.polled_data()]);
  return {
    magic: header.magic,
    stream_type: header.stream_type,
    tick_span: header.tick_span as bigint,
    streams: header.streams.map((s: any) => ({
      type_structure: s.type_structure,
      id: s.id,
      notes: s.notes,
      type_size: s.type_size,
      tick_interval: BigInt(s.stream_info.tick_interval),
      tick_phase: BigInt(s.stream_info.tick_phase),
    })),
    samples: data.map((s: any) => ({
      stream_idx: header.streams.findIndex((stream: any) => stream.id === s.stream.id),
      sample_tick: BigInt(s.tick),
      buffer: s.data,
    })),
  };
}

async function assembleEvent(adapter: Adapter): Promise<TEventLogObj> {
  const [header, data] = await Promise.all([adapter.events_header(), adapter.events_data()]);
  return {
    magic: header.magic,
    stream_type: header.stream_type,
    tick_span: header.tick_span as bigint,
    streams: header.streams.map((s) => ({
      type_structure: s.type_structure,
      id: s.id,
      notes: s.notes,
      type_size: s.type_size,
    })),
    samples: data.map((s: any) => ({
      stream_idx: s.stream_idx,
      sample_tick: BigInt(s.tick),
      buffer: s.data,
    })),
  };
}

// Takes existing dlf file in resources
// DLF -> parse -> JS Object -> encode -> DLF' , check DLF against DLF'

async function runRoundTrip<T>(
  label: string,
  filePath: string,
  assembler: (a: Adapter) => Promise<T>,
  encoder: (obj: T) => Promise<Uint8Array>
) {
  console.log(`\n--- Round-Trip [${label}]: ${filePath} ---`);
  const tempFile = `./tests/resources/test_output_${label.toLowerCase()}.dlf`;

    const origAdapter = new LocalFileAdapter(filePath);
    const originalObj = await assembler(origAdapter);

    const encodedBytes = await encoder(originalObj);
    fs.writeFileSync(tempFile, encodedBytes);

    const newAdapter = new LocalFileAdapter(tempFile);
    const roundTrippedObj = await assembler(newAdapter);

    expect(roundTrippedObj).toStrictEqual(originalObj);
    console.log(`${label} Matched.`);
}

// build path to dlf files in resources/gps

//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);

const RESOURCE_BASE = path.resolve(process.cwd(), "tests/resources/gps");

// vitest

test("Round-trip META: meta.dlf", async () => {
  const filePath = path.join(RESOURCE_BASE, "meta.dlf");
  await runRoundTrip("META", filePath, assembleMeta, encode_meta);
});

test("Round-trip POLLED: polled.dlf", async () => {
  const filePath = path.join(RESOURCE_BASE, "polled.dlf");
  await runRoundTrip("POLLED", filePath, assemblePolled, encode_polled);
});

test("Round-trip EVENT: event.dlf", async () => {
  const filePath = path.join(RESOURCE_BASE, "event.dlf");
  await runRoundTrip("EVENT", filePath, assembleEvent, encode_events);
});
