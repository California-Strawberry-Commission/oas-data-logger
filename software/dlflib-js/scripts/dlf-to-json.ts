import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Adapter, EventDlf, MetaDlf, PolledDlf } from "../src/dlflib.js";
import { FSAdapter } from "../src/fsadapter.js";

/**
 * Converts a run directory's meta.dlf, polled.dlf, and event.dlf into JSON.
 *
 * USAGE:
 * npm run dlf-to-json -- <run-dir> [--out-dir <out-dir>]
 *
 * If --out-dir is omitted, the JSON files are written into <run-dir>.
 */

const {
  values: { "out-dir": outDirRaw },
  positionals,
} = parseArgs({
  options: {
    "out-dir": { type: "string" },
  },
  allowPositionals: true,
});

const runDir = positionals[0];

if (!runDir) {
  console.error("Usage: npm run dlf-to-json -- <run-dir> [--out-dir <out-dir>]");
  process.exit(1);
}

const outDir = outDirRaw ?? runDir;

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
    tickSpan: header.tickSpan,
    streams: header.streams.map((s) => ({
      typeStructure: s.typeStructure,
      id: s.id,
      notes: s.notes,
      typeSize: s.typeSize,
      tickInterval: BigInt(
        (s.streamInfo as { tickInterval: bigint }).tickInterval,
      ),
      tickPhase: BigInt((s.streamInfo as { tickPhase: bigint }).tickPhase),
    })),
    samples: data.map((s) => ({
      streamIdx: header.streams.findIndex(
        (stream) => stream.id === s.stream.id,
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
    tickSpan: header.tickSpan,
    streams: header.streams.map((s) => ({
      typeStructure: s.typeStructure,
      id: s.id,
      notes: s.notes,
      typeSize: s.typeSize,
    })),
    samples: data.map((s) => ({
      streamIdx: s.streamIdx,
      sampleTick: BigInt(s.tick),
      buffer: s.data,
    })),
  };
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function convert(
  name: string,
  assemble: () => Promise<unknown>,
  outDir: string,
) {
  const obj = await assemble();
  const outPath = resolve(outDir, `${name}.json`);
  await writeFile(outPath, JSON.stringify(obj, jsonReplacer, 2));
  console.log(`Wrote ${outPath}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const adapter = new FSAdapter(runDir);

  await Promise.all([
    convert("meta", () => assembleMeta(adapter), outDir),
    convert("polled", () => assemblePolled(adapter), outDir),
    convert("event", () => assembleEvent(adapter), outDir),
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
