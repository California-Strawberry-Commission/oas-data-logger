import { expect, test } from "vitest";
import { FSAdapter } from "../src/fsadapter";

const fsAdapter = new FSAdapter("tests/resources/gps");

test("Meta header", async () => {
  expect(await fsAdapter.meta_header()).toMatchObject({
    magic: 33812,
    epoch_time_s: 1763485651,
    tick_base_us: 100000,
    meta_structure: "double",
    meta_size: 8,
  });

  // TODO: check fsAdapter.meta()
});

test("Polled headers", async () => {
  expect(await fsAdapter.polled_header()).toMatchObject({
    magic: 33812,
    stream_type: 0,
    tick_span: 1832n,
    num_streams: 4,
    streams: [
      {
        type_structure: "uint32_t",
        id: "gpsData.satellites",
        notes: "N/A",
        type_size: 4,
        stream_info: {
          tick_interval: 50n,
          tick_phase: 0n,
        },
      },
      {
        type_structure: "double",
        id: "gpsData.lat",
        notes: "N/A",
        type_size: 8,
        stream_info: {
          tick_interval: 10n,
          tick_phase: 0n,
        },
      },
      {
        type_structure: "double",
        id: "gpsData.lng",
        notes: "N/A",
        type_size: 8,
        stream_info: {
          tick_interval: 10n,
          tick_phase: 0n,
        },
      },
      {
        type_structure: "double",
        id: "gpsData.alt",
        notes: "N/A",
        type_size: 8,
        stream_info: {
          tick_interval: 10n,
          tick_phase: 0n,
        },
      },
    ],
  });
});

test("Polled data", async () => {
  expect(await fsAdapter.polled_data(0n, 10n)).toMatchObject([
    {
      stream: {
        type_structure: "uint32_t",
        id: "gpsData.satellites",
        notes: "N/A",
        type_size: 4,
        stream_info: {
          tick_interval: 50n,
          tick_phase: 0n,
        },
      },
      data: 3,
      tick: 0n,
      offset: 0n,
    },
    {
      stream: {
        type_structure: "double",
        id: "gpsData.lat",
        notes: "N/A",
        type_size: 8,
        stream_info: {
          tick_interval: 10n,
          tick_phase: 0n,
        },
      },
      data: 35.3053619,
      tick: 0n,
      offset: 4n,
    },
    {
      stream: {
        type_structure: "double",
        id: "gpsData.lng",
        notes: "N/A",
        type_size: 8,
        stream_info: {
          tick_interval: 10n,
          tick_phase: 0n,
        },
      },
      data: -120.6720945,
      tick: 0n,
      offset: 12n,
    },
    {
      stream: {
        type_structure: "double",
        id: "gpsData.alt",
        notes: "N/A",
        type_size: 8,
        stream_info: {
          tick_interval: 10n,
          tick_phase: 0n,
        },
      },
      data: 85.306,
      tick: 0n,
      offset: 20n,
    },
  ]);
});

// TODO: test with actual event data
test("Events header", async () => {
  expect(await fsAdapter.events_header()).toMatchObject({
    magic: 33812,
    stream_type: 1,
    tick_span: 1832n,
    num_streams: 0,
    streams: [],
  });
});
