import { expect, test } from "vitest";
import {
  Adapter,
  TEventLogObj,
  TPolledLogObj,
  TMetaObj,
  encode_meta,
  encode_polled,
  encode_events,
} from "../src/dlflib.js";

class LocalAdapter extends Adapter {
  constructor(
    private metaBytes: Uint8Array = new Uint8Array(),
    private polledBytes: Uint8Array = new Uint8Array(),
    private eventsBytes: Uint8Array = new Uint8Array(),
  ) {
    super();
  }
  get polled_dlf() {
    return Promise.resolve(this.polledBytes);
  }
  get events_dlf() {
    return Promise.resolve(this.eventsBytes);
  }
  get meta_dlf() {
    return Promise.resolve(this.metaBytes);
  }
}

// Helper functions

async function assembleMeta(adapter: Adapter): Promise<TMetaObj> {
  const [header, data] = await Promise.all([
    adapter.meta_header(),
    adapter.meta(),
  ]);
  return {
    magic: header.magic,
    epoch_time_s: header.epoch_time_s,
    tick_base_us: header.tick_base_us,
    meta_structure: header.meta_structure,
    meta: data,
  };
}

async function assemblePolled(adapter: Adapter): Promise<TPolledLogObj> {
  const [header, data] = await Promise.all([
    adapter.polled_header(),
    adapter.polled_data(),
  ]);
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
      stream_idx: header.streams.findIndex(
        (stream: any) => stream.id === s.stream.id,
      ),
      sample_tick: BigInt(s.tick),
      buffer: s.data,
    })),
  };
}

async function assembleEvent(adapter: Adapter): Promise<TEventLogObj> {
  const [header, data] = await Promise.all([
    adapter.events_header(),
    adapter.events_data(),
  ]);
  return {
    magic: header.magic,
    stream_type: header.stream_type,
    tick_span: header.tick_span as bigint,
    streams: header.streams.map((s: any) => ({
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

// Tests

test("Round-trip for Meta: Primitive Fields", async () => {
  const originalObj: TMetaObj = {
    magic: 33812,
    epoch_time_s: 1763485651,
    tick_base_us: 100000,
    meta_structure: "double",
    meta: 3.14,
  };

  const encodedBytes = encode_meta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toStrictEqual(originalObj);
});

test("Round-trip for Meta: Non-Primitive Fields", async () => {
  const originalObj: TMetaObj = {
    magic: 33812,
    epoch_time_s: 1763485651,
    tick_base_us: 100000,
    meta_structure: "meta_data;id:uint32_t:0;active:bool:4",
    meta: {
      id: 42,
      active: 1,
    },
  };

  const encodedBytes = encode_meta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});
