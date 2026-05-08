import { expect, test } from "vitest";
import { FSAdapter } from "../src/fsadapter";

const fsAdapter = new FSAdapter("tests/resources/gps");

test("Meta header", async () => {
  expect(await fsAdapter.getMetaDlf()).toMatchObject({
    magic: 33812,
    epochTimeS: 1763485651,
    tickBaseUs: 100000,
    metaStructure: "double",
    metaSize: 8,
  });

  // TODO: check fsAdapter.meta()
});

test("Polled headers", async () => {
  expect(await fsAdapter.getPolledDlf()).toMatchObject({
    magic: 33812,
    streamType: 0,
    tickSpan: 1832n,
    numStreams: 4,
    streams: [
      {
        typeStructure: "uint32_t",
        id: "gpsData.satellites",
        notes: "N/A",
        typeSize: 4,
        streamInfo: {
          tickInterval: 50n,
          tickPhase: 0n,
        },
      },
      {
        typeStructure: "double",
        id: "gpsData.lat",
        notes: "N/A",
        typeSize: 8,
        streamInfo: {
          tickInterval: 10n,
          tickPhase: 0n,
        },
      },
      {
        typeStructure: "double",
        id: "gpsData.lng",
        notes: "N/A",
        typeSize: 8,
        streamInfo: {
          tickInterval: 10n,
          tickPhase: 0n,
        },
      },
      {
        typeStructure: "double",
        id: "gpsData.alt",
        notes: "N/A",
        typeSize: 8,
        streamInfo: {
          tickInterval: 10n,
          tickPhase: 0n,
        },
      },
    ],
  });
});

test("Polled data", async () => {
  expect(await fsAdapter.getPolledData(0n, 10n)).toMatchObject([
    {
      stream: {
        typeStructure: "uint32_t",
        id: "gpsData.satellites",
        notes: "N/A",
        typeSize: 4,
        streamInfo: {
          tickInterval: 50n,
          tickPhase: 0n,
        },
      },
      data: 3,
      tick: 0n,
      offset: 0n,
    },
    {
      stream: {
        typeStructure: "double",
        id: "gpsData.lat",
        notes: "N/A",
        typeSize: 8,
        streamInfo: {
          tickInterval: 10n,
          tickPhase: 0n,
        },
      },
      data: 35.3053619,
      tick: 0n,
      offset: 4n,
    },
    {
      stream: {
        typeStructure: "double",
        id: "gpsData.lng",
        notes: "N/A",
        typeSize: 8,
        streamInfo: {
          tickInterval: 10n,
          tickPhase: 0n,
        },
      },
      data: -120.6720945,
      tick: 0n,
      offset: 12n,
    },
    {
      stream: {
        typeStructure: "double",
        id: "gpsData.alt",
        notes: "N/A",
        typeSize: 8,
        streamInfo: {
          tickInterval: 10n,
          tickPhase: 0n,
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
  expect(await fsAdapter.getEventDlf()).toMatchObject({
    magic: 33812,
    streamType: 1,
    tickSpan: 1832n,
    numStreams: 0,
    streams: [],
  });
});
