import { expect, test } from "vitest";
import {
  Adapter,
  EventDlf,
  PolledDlf,
  MetaDlf,
  encodeMeta,
  encodePolled,
  encodeEvent,
} from "../src/dlflib.js";

class LocalAdapter extends Adapter {
  constructor(
    private metaBytes: Uint8Array = new Uint8Array(),
    private polledBytes: Uint8Array = new Uint8Array(),
    private eventBytes: Uint8Array = new Uint8Array(),
  ) {
    super();
  }
  get metaDlfBytes() {
    return Promise.resolve(this.metaBytes);
  }
  get polledDlfBytes() {
    return Promise.resolve(this.polledBytes);
  }
  get eventDlfBytes() {
    return Promise.resolve(this.eventBytes);
  }
}

// Helper functions

async function assembleMeta(adapter: Adapter): Promise<MetaDlf> {
  const [header, data] = await Promise.all([
    adapter.getMetaDlf(),
    adapter.getMeta(),
  ]);
  return {
    magic: header.magic,
    epochTimeS: header.epochTimeS,
    tickBaseUs: header.tickBaseUs,
    metaStructure: header.metaStructure,
    metaSize: header.metaSize,
    meta: data,
  };
}

async function assemblePolled(adapter: Adapter): Promise<PolledDlf> {
  const [header, data] = await Promise.all([
    adapter.getPolledDlf(),
    adapter.getPolledData(),
  ]);
  return {
    magic: header.magic,
    streamType: header.streamType,
    tickSpan: header.tickSpan as bigint,
    streams: header.streams.map((s: any) => ({
      typeStructure: s.typeStructure,
      id: s.id,
      notes: s.notes,
      typeSize: s.typeSize,
      tickInterval: BigInt(s.streamInfo.tickInterval),
      tickPhase: BigInt(s.streamInfo.tickPhase),
    })),
    samples: data.map((s: any) => ({
      streamIdx: header.streams.findIndex(
        (stream: any) => stream.id === s.stream.id,
      ),
      sampleTick: BigInt(s.tick),
      buffer: s.data,
    })),
  };
}

async function assembleEvent(adapter: Adapter): Promise<EventDlf> {
  const [header, data] = await Promise.all([
    adapter.getEventDlf(),
    adapter.getEventData(),
  ]);
  return {
    magic: header.magic,
    streamType: header.streamType,
    tickSpan: header.tickSpan as bigint,
    streams: header.streams.map((s: any) => ({
      typeStructure: s.typeStructure,
      id: s.id,
      notes: s.notes,
      typeSize: s.typeSize,
    })),
    samples: data.map((s: any) => ({
      streamIdx: s.streamIdx,
      sampleTick: BigInt(s.tick),
      buffer: s.data,
    })),
  };
}

// Meta Tests

test("Round-trip for Meta: Primitive Fields", async () => {
  const originalObj: MetaDlf = {
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "double",
    metaSize: 8,
    meta: 3.14,
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Non-Primitive Fields", async () => {
  const originalObj: MetaDlf = {
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "meta_struct;id:uint32_t:0;active:bool:4",
    metaSize: 5,
    meta: {
      id: 42,
      active: 1,
    },
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Zero'd Out", async () => {
  const originalObj: MetaDlf = {
    magic: 0,
    epochTimeS: 0,
    tickBaseUs: 0,
    metaStructure: "meta_struct;meta_size:uint32_t:0;epoch_time_s:uint32_t:4",
    metaSize: 8,
    meta: {
      meta_size: 0,
      epoch_time_s: 0,
    },
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Missing and Extra Fields", async () => {
  const originalObj: MetaDlf = {
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "meta_struct;id:uint32_t:0;active:bool:4",
    metaSize: 5,
    meta: {
      id: 42,
      extra_field: "Ignore me",
    },
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj.meta).toMatchObject({
    id: 42,
    active: 0,
  });
});

test("Round-trip for Meta: Internal Padding", async () => {
  const originalObj: MetaDlf = {
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "padded;a:uint8_t:0;b:uint32_t:8",
    metaSize: 12,
    meta: {
      a: 255,
      b: 4294967295,
    },
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Tail Padding", async () => {
  const originalObj: MetaDlf = {
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "tailpadding;a:uint8_t:0;b:uint8_t:1",
    metaSize: 4,
    meta: {
      a: 10,
      b: 20,
    },
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Meta: Ignores ! prefix", async () => {
  const originalObj: MetaDlf = {
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "!test",
    metaSize: 0,
    meta: null,
  };

  const encodedBytes = encodeMeta(originalObj);
  const adapter = new LocalAdapter(encodedBytes);
  const roundTrippedObj = await assembleMeta(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

// Polled Tests

test("Round-trip for Polled: Primitive Fields", async () => {
  const originalObj: PolledDlf = {
    magic: 33812,
    streamType: 0,
    tickSpan: 1000n,
    streams: [
      {
        typeStructure: "double",
        id: "gpsData.lat",
        notes: "Primitive Data",
        typeSize: 8,
        tickInterval: 10n,
        tickPhase: 0n,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 0n,
        buffer: 35.3053619,
      },
      {
        streamIdx: 0,
        sampleTick: 10n,
        buffer: 35.305365,
      },
    ],
  };

  const encodedBytes = encodePolled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Non-Primitive Fields", async () => {
  const originalObj: PolledDlf = {
    magic: 33812,
    streamType: 0,
    tickSpan: 1000n,
    streams: [
      {
        typeStructure:
          "gps_data;satellites:uint32_t:0;lat:double:4;lng:double:12",
        id: "gpsData",
        notes: "Non Prim Data",
        typeSize: 20,
        tickInterval: 10n,
        tickPhase: 0n,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 0n,
        buffer: {
          satellites: 4,
          lat: 35.305,
          lng: -120.672,
        },
      },
    ],
  };

  const encodedBytes = encodePolled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Multiple Interleaved Streams", async () => {
  const originalObj: PolledDlf = {
    magic: 33812,
    streamType: 0,
    tickSpan: 100n,
    streams: [
      {
        typeStructure: "uint32_t",
        id: "gpsData.satellites",
        notes: "Slower interval",
        typeSize: 4,
        tickInterval: 50n,
        tickPhase: 0n,
      },
      {
        typeStructure: "double",
        id: "gpsData.lat",
        notes: "Faster interval",
        typeSize: 8,
        tickInterval: 10n,
        tickPhase: 0n,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 0n,
        buffer: 4,
      },
      {
        streamIdx: 1,
        sampleTick: 0n,
        buffer: 35.305,
      },
      {
        streamIdx: 1,
        sampleTick: 10n,
        buffer: 35.306,
      },
    ],
  };

  const encodedBytes = encodePolled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Zero Samples", async () => {
  const originalObj: PolledDlf = {
    magic: 33812,
    streamType: 0,
    tickSpan: 0n,
    streams: [
      {
        typeStructure: "double",
        id: "gpsData.lat",
        notes: "Empty",
        typeSize: 8,
        tickInterval: 10n,
        tickPhase: 0n,
      },
    ],
    samples: [],
  };

  const encodedBytes = encodePolled(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    encodedBytes,
    new Uint8Array(),
  );
  const roundTrippedObj = await assemblePolled(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Polled: Missing and Extra Fields", async () => {
  const originalObj: PolledDlf = {
    magic: 33812,
    streamType: 0,
    tickSpan: 1000n,
    streams: [
      {
        typeStructure: "gps_data;lat:double:0;lng:double:8",
        id: "gpsData",
        notes: "Missing and Extra fields",
        typeSize: 16,
        tickInterval: 10n,
        tickPhase: 0n,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 0n,
        buffer: {
          lat: 35.305,
          speed: 120.5,
        },
      },
    ],
  };

  const encodedBytes = encodePolled(originalObj);
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
  const originalObj: EventDlf = {
    magic: 33812,
    streamType: 1,
    tickSpan: 500n,
    streams: [
      {
        typeStructure: "uint8_t",
        id: "gpsData",
        notes: "Primitive Data",
        typeSize: 1,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 150n,
        buffer: 1,
      },
    ],
  };

  const encodedBytes = encodeEvent(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Events: Non Primitive Fields", async () => {
  const originalObj: EventDlf = {
    magic: 33812,
    streamType: 1,
    tickSpan: 500n,
    streams: [
      {
        typeStructure: "status;on:uint8_t:0;off:uint8_t:1",
        id: "gpsData.status",
        notes: "Non Prim Data",
        typeSize: 2,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 150n,
        buffer: {
          on: 1,
          off: 0,
        },
      },
    ],
  };

  const encodedBytes = encodeEvent(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Events: Zero Events", async () => {
  const originalObj: EventDlf = {
    magic: 33812,
    streamType: 1,
    tickSpan: 0n,
    streams: [
      {
        typeStructure: "uint8_t",
        id: "gpsData",
        notes: "Zero Events",
        typeSize: 1,
      },
    ],
    samples: [],
  };

  const encodedBytes = encodeEvent(originalObj);
  const adapter = new LocalAdapter(
    new Uint8Array(),
    new Uint8Array(),
    encodedBytes,
  );
  const roundTrippedObj = await assembleEvent(adapter);

  expect(roundTrippedObj).toMatchObject(originalObj);
});

test("Round-trip for Events: Missing struct fields default to zero", async () => {
  const originalObj: EventDlf = {
    magic: 33812,
    streamType: 1,
    tickSpan: 500n,
    streams: [
      {
        typeStructure: "gps_data;satellites:uint32_t:0;alt:double:4",
        id: "gpsData",
        notes: "Missing Data",
        typeSize: 12,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 10n,
        buffer: {
          satellites: 5,
        },
      },
    ],
  };

  const encodedBytes = encodeEvent(originalObj);
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
  const originalObj: EventDlf = {
    magic: 33812,
    streamType: 1,
    tickSpan: 500n,
    streams: [
      {
        typeStructure: "gps_data;lat:double:0",
        id: "gpsData",
        notes: "Extra Data",
        typeSize: 8,
      },
    ],
    samples: [
      {
        streamIdx: 0,
        sampleTick: 20n,
        buffer: {
          lat: 35.305,
          speed: 120.5,
        },
      },
    ],
  };

  const encodedBytes = encodeEvent(originalObj);
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
