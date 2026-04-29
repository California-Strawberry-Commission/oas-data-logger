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

// Meta Tests

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

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Non-Primitive Fields", async () => {
  const originalObj: TMetaObj = {
    magic: 33812,
    epoch_time_s: 1763485651,
    tick_base_us: 100000,
    meta_structure: "meta_struct;id:uint32_t:0;active:bool:4",
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

test("Round-trip for Meta: Zero'd Out", async () => {
  const originalObj: TMetaObj = {
    magic: 0,
    epoch_time_s: 0,
    tick_base_us: 0,
    meta_structure: "meta_struct;meta_size:uint32_t:0;epoch_time_s:uint32_t:4",
    meta: {
      meta_size: 0,
      epoch_time_s: 0,
    },
  };

  const encodedBytes = encode_meta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Missing and Extra Fields", async () => {
  const originalObj: TMetaObj = {
    magic: 33812,
    epoch_time_s: 1763485651,
    tick_base_us: 100000,
    meta_structure: "meta_struct;id:uint32_t:0;active:bool:4",
    meta: {
      id: 42,
      extra_field: "Ignore me",
    },
  };

  const encodedBytes = encode_meta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj.meta).toMatchObject({
    id: 42,
    active: 0,
  });
});

// Polled Tests

test("Round-trip for Polled: Primitive Fields", async () => {
  const originalObj: TPolledLogObj = {
    magic: 33812,
    stream_type: 0,
    tick_span: 1000n,
    streams: [
      {
        type_structure: "double",
        id: "gpsData.lat",
        notes: "Primitive Data",
        type_size: 8,
        tick_interval: 10n,
        tick_phase: 0n,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 0n,
        buffer: 35.3053619,
      },
      {
        stream_idx: 0,
        sample_tick: 10n,
        buffer: 35.305365,
      },
    ],
  };

  const encodedBytes = encode_polled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Non-Primitive Fields", async () => {
  const originalObj: TPolledLogObj = {
    magic: 33812,
    stream_type: 0,
    tick_span: 1000n,
    streams: [
      {
        type_structure:
          "gps_data;satellites:uint32_t:0;lat:double:4;lng:double:12",
        id: "gpsData",
        notes: "Non Prim Data",
        type_size: 20,
        tick_interval: 10n,
        tick_phase: 0n,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 0n,
        buffer: {
          satellites: 4,
          lat: 35.305,
          lng: -120.672,
        },
      },
    ],
  };

  const encodedBytes = encode_polled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Multiple Interleaved Streams", async () => {
  const originalObj: TPolledLogObj = {
    magic: 33812,
    stream_type: 0,
    tick_span: 100n,
    streams: [
      {
        type_structure: "uint32_t",
        id: "gpsData.satellites",
        notes: "Slower interval",
        type_size: 4,
        tick_interval: 50n,
        tick_phase: 0n,
      },
      {
        type_structure: "double",
        id: "gpsData.lat",
        notes: "Faster interval",
        type_size: 8,
        tick_interval: 10n,
        tick_phase: 0n,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 0n,
        buffer: 4,
      },
      {
        stream_idx: 1,
        sample_tick: 0n,
        buffer: 35.305,
      },
      {
        stream_idx: 1,
        sample_tick: 10n,
        buffer: 35.306,
      },
    ],
  };

  const encodedBytes = encode_polled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Zero Samples", async () => {
  const originalObj: TPolledLogObj = {
    magic: 33812,
    stream_type: 0,
    tick_span: 0n,
    streams: [
      {
        type_structure: "double",
        id: "gpsData.lat",
        notes: "Empty",
        type_size: 8,
        tick_interval: 10n,
        tick_phase: 0n,
      },
    ],
    samples: [],
  };

  const encodedBytes = encode_polled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Missing and Extra Fields", async () => {
  const originalObj: TPolledLogObj = {
    magic: 33812,
    stream_type: 0,
    tick_span: 1000n,
    streams: [
      {
        type_structure: "gps_data;lat:double:0;lng:double:8",
        id: "gpsData",
        notes: "Missing and Extra fields",
        type_size: 16,
        tick_interval: 10n,
        tick_phase: 0n,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 0n,
        buffer: {
          lat: 35.305,
          speed: 120.5,
        },
      },
    ],
  };

  const encodedBytes = encode_polled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj.samples[0].buffer).toMatchObject({
    lat: 35.305,
    lng: 0,
  });
});

// Events Tests

test("Round-trip for Events: Primitive Fields", async () => {
  const originalObj: TEventLogObj = {
    magic: 33812,
    stream_type: 1,
    tick_span: 500n,
    streams: [
      {
        type_structure: "uint8_t",
        id: "gpsData",
        notes: "Primitive Data",
        type_size: 1,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 150n,
        buffer: 1,
      },
    ],
  };

  const encodedBytes = encode_events(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Events: Non Primitive Fields", async () => {
  const originalObj: TEventLogObj = {
    magic: 33812,
    stream_type: 1,
    tick_span: 500n,
    streams: [
      {
        type_structure: "status;on:uint8_t:0;off:uint8_t:1",
        id: "gpsData.status",
        notes: "Non Prim Data",
        type_size: 2,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 150n,
        buffer: {
          on: 1,
          off: 0,
        },
      },
    ],
  };

  const encodedBytes = encode_events(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Events: Zero Events", async () => {
  const originalObj: TEventLogObj = {
    magic: 33812,
    stream_type: 1,
    tick_span: 0n,
    streams: [
      {
        type_structure: "uint8_t",
        id: "gpsData",
        notes: "Zero Events",
        type_size: 1,
      },
    ],
    samples: [],
  };

  const encodedBytes = encode_events(originalObj);
  const adapter = new LocalAdapter(new Uint8Array(), new Uint8Array(), encodedBytes);
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Events: Missing struct fields default to zero", async () => {
  const originalObj: TEventLogObj = {
    magic: 33812,
    stream_type: 1,
    tick_span: 500n,
    streams: [
      {
        type_structure: "gps_data;satellites:uint32_t:0;alt:double:4",
        id: "gpsData",
        notes: "Missing Data",
        type_size: 12,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 10n,
        buffer: {
          satellites: 5,
        },
      },
    ],
  };

  const encodedBytes = encode_events(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj.samples[0].buffer).toMatchObject({
    satellites: 5,
    alt: 0,
  });
});

test("Round-trip for Events: Extra fields are safely ignored", async () => {
  const originalObj: TEventLogObj = {
    magic: 33812,
    stream_type: 1,
    tick_span: 500n,
    streams: [
      {
        type_structure: "gps_data;lat:double:0",
        id: "gpsData",
        notes: "Extra Data",
        type_size: 8,
      },
    ],
    samples: [
      {
        stream_idx: 0,
        sample_tick: 20n,
        buffer: {
          lat: 35.305,
          speed: 120.5,
        },
      },
    ],
  };

  const encodedBytes = encode_events(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj.samples[0].buffer).toMatchObject({
    lat: 35.305,
  });
});
