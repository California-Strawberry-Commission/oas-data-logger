import { Parser } from "binary-parser";
import {
  Struct,
  StructType,
  ConstructDataType,
  U8,
  U16,
  U32,
  U64,
  I8,
  I16,
  I32,
  I64,
  NullTerminatedString,
  U8s,
  DataType,
} from "construct-js";
import { F32, F64 } from "./construct_float.js";

//#region Types

export type ParsedDataDlf = {
  magic: number;
  streamType: number;
  tickSpan: bigint;
  numStreams: number;
  streams: {
    typeStructure: string;
    id: string;
    notes: string;
    typeSize: number;
    streamInfo:
      | { tickInterval: bigint; tickPhase: bigint }
      | Record<string, never>;
  }[];
  data: Uint8Array;
};

type Stream = ParsedDataDlf["streams"][0];

export type ParsedMetaDlf = {
  magic: number;
  epochTimeS: number;
  tickBaseUs: number;
  metaStructure: string;
  metaSize: number;
  meta: Uint8Array;
};

export type MetaDlf = {
  magic: number;
  epochTimeS: number;
  tickBaseUs: number;
  metaStructure: string;
  metaSize: number;
  meta: any;
};

export type EventDlf = {
  magic: number;
  streamType: number;
  tickSpan: bigint;
  streams: Array<{
    typeStructure: string;
    id: string;
    notes: string;
    typeSize: number;
  }>;
  samples: Array<{
    streamIdx: number;
    sampleTick: bigint;
    buffer: any;
  }>;
};

export type PolledDlf = {
  magic: number;
  streamType: number;
  tickSpan: bigint;
  streams: Array<{
    typeStructure: string;
    id: string;
    notes: string;
    typeSize: number;
    tickInterval: bigint;
    tickPhase: bigint;
  }>;
  samples: Array<{
    streamIdx: number;
    sampleTick: bigint;
    buffer: any;
  }>;
};

//#endregion

//#region Primitive type maps

const BINARY_PARSERS_PRIMITIVES = {
  uint8_t: "uint8",
  bool: "uint8",
  uint16_t: "uint16le",
  uint32_t: "uint32le",
  uint64_t: "uint64le",
  int8_t: "int8",
  int16_t: "int16le",
  int32_t: "int32le",
  int64_t: "int64le",
  float: "floatle",
  double: "doublele",
} as const;

// See construct_float.js for implementation of F32 && F64
const ENCODER_PRIMITIVES = {
  uint8_t: U8,
  bool: U8,
  uint16_t: U16,
  uint32_t: U32,
  uint64_t: U64,
  int8_t: I8,
  int16_t: I16,
  int32_t: I32,
  int64_t: I64,
  float: F32,
  double: F64,
} as const;

//#endregion

//#region Binary parsers

const metaDlfParser = new Parser()
  .endianness("little")
  .uint16("magic")
  .uint32("epochTimeS")
  .uint32("tickBaseUs")
  .string("metaStructure", { zeroTerminated: true })
  .uint32("metaSize")
  .buffer("meta", { readUntil: "eof" });

const dataDlfParser = new Parser()
  // @ts-ignore
  .useContextVars()
  .endianness("little")
  .uint16("magic")
  .uint8("streamType")
  .uint64("tickSpan")
  .uint16("numStreams")
  .array("streams", {
    length: "numStreams",
    type: new Parser()
      .string("typeStructure", { zeroTerminated: true })
      .string("id", { zeroTerminated: true })
      .string("notes", { zeroTerminated: true })
      .uint32le("typeSize")
      .choice("streamInfo", {
        tag: function () {
          // $root references the root structure
          // @ts-ignore
          return this.$root.streamType;
        },
        choices: {
          0: new Parser().uint64le("tickInterval").uint64le("tickPhase"), // polled
          1: new Parser(), // event
        },
      }),
  })
  .buffer("data", { readUntil: "eof" });

//#endregion

//#region Encoder factories

function createMetaHeaderEncoder() {
  return Struct("MetaDlfHeader")
    .field("magic", U16(0))
    .field("epochTimeS", U32(0))
    .field("tickBaseUs", U32(0))
    .field("metaStructure", NullTerminatedString(""))
    .field("metaSize", U32(0));
}

function createDataDlfHeaderEncoder() {
  return Struct("DataDlfHeader")
    .field("magic", U16(0))
    .field("streamType", U8(0))
    .field("tickSpan", U64(0n))
    .field("numStreams", U16(0));
}

function createEventStreamHeaderEncoder() {
  return Struct("EventStreamHeader")
    .field("typeStructure", NullTerminatedString(""))
    .field("id", NullTerminatedString(""))
    .field("notes", NullTerminatedString(""))
    .field("typeSize", U32(0));
}

function createEventSampleHeaderEncoder() {
  return Struct("EventSampleHeader")
    .field("streamIdx", U16(0))
    .field("sampleTick", U64(0n));
}

function createPolledStreamHeaderEncoder() {
  return Struct("PolledStreamHeader")
    .field("typeStructure", NullTerminatedString(""))
    .field("id", NullTerminatedString(""))
    .field("notes", NullTerminatedString(""))
    .field("typeSize", U32(0))
    .field("tickInterval", U64(0n))
    .field("tickPhase", U64(0n));
}

//#endregion

//#region Math helpers

function mod(a: bigint, m: bigint) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

// First tick >= 0 such that (tick + phase) % interval == 0
function firstTick(interval: bigint, phase: bigint) {
  return mod(-phase, interval);
}

// Smallest tick >= start such that (tick + phase) % interval == 0
function nextDueAtOrAfter(start: bigint, interval: bigint, phase: bigint) {
  const f = firstTick(interval, phase);
  if (start <= f) {
    return f;
  }
  const k = (start - f + interval - 1n) / interval; // ceil
  return f + k * interval;
}

// Number of due ticks in [0, t) for a stream
function countBefore(t: bigint, interval: bigint, phase: bigint) {
  const f = firstTick(interval, phase);
  if (t <= f) {
    return 0n;
  }
  // Ticks are f, f+interval, f+2*interval, ... < t
  return 1n + (t - 1n - f) / interval;
}

//#endregion

//#region Encoder helpers

function createEncoder(
  structure: string,
  structureSize?: number,
): StructType | Function | null {
  if (structure.startsWith("!")) {
    return null;
  }

  if (structure in ENCODER_PRIMITIVES) {
    return ENCODER_PRIMITIVES[structure as keyof typeof ENCODER_PRIMITIVES];
  }

  const [name, ...members] = structure.split(";");
  const encoder = Struct(name);
  let currentOffset = 0;

  for (const m of members) {
    const [memberName, typeName, offsetStr] = m.split(":");
    const relOff = parseInt(offsetStr);
    const primitiveEncoder = ENCODER_PRIMITIVES[
      typeName as keyof typeof ENCODER_PRIMITIVES
    ] as (value: number | bigint) => ConstructDataType;
    const paddingNeeded = relOff - currentOffset;

    if (paddingNeeded > 0) {
      encoder.field(
        `__padding_${memberName}`,
        U8s(new Array(paddingNeeded).fill(0)),
      );
      currentOffset += paddingNeeded;
    }

    let defaultValue: number | bigint = 0;

    if (typeName === "uint64_t" || typeName === "int64_t") {
      defaultValue = 0n;
    }

    const fieldInstance = primitiveEncoder(defaultValue);
    encoder.field(memberName, fieldInstance);
    currentOffset += fieldInstance.computeBufferSize();
  }

  if (structureSize != null && structureSize > currentOffset) {
    const tailPadding = structureSize - currentOffset;
    encoder.field(`__padding_eof`, U8s(new Array(tailPadding).fill(0)));
  }

  return encoder;
}

function getEncoderField(
  typeStructure: string,
  dataObj: any,
  structureSize?: number,
): ConstructDataType | undefined {
  const encoder = createEncoder(typeStructure, structureSize);

  // Handle primitive data
  if (typeof encoder === "function") {
    return encoder(dataObj);
  }

  // Handle object data
  if (encoder) {
    for (const key of Object.keys(dataObj)) {
      try {
        const field = encoder.get(key) as any;
        if (field && typeof field.set === "function") {
          field.set(dataObj[key]);
        }
      } catch (error) {
        continue; // simply ignore non defined struct values
      }
    }
    return encoder;
  }

  return undefined;
}

//#endregion

//#region Encode functions

export function encodeMeta(metaObj: MetaDlf): Uint8Array {
  const metaHeaderEncoder = createMetaHeaderEncoder();
  let metaDataField: ConstructDataType | undefined;

  metaHeaderEncoder.get<DataType<typeof U16>>("magic").set(metaObj.magic);
  metaHeaderEncoder
    .get<DataType<typeof U32>>("epochTimeS")
    .set(metaObj.epochTimeS);
  metaHeaderEncoder
    .get<DataType<typeof U32>>("tickBaseUs")
    .set(metaObj.tickBaseUs);
  metaHeaderEncoder
    .get<DataType<typeof NullTerminatedString>>("metaStructure")
    .set(metaObj.metaStructure);
  metaHeaderEncoder.get<DataType<typeof U32>>("metaSize").set(metaObj.metaSize);

  const metaDlfEncoder = Struct("MetaDlf").field("header", metaHeaderEncoder);

  metaDataField = getEncoderField(
    metaObj.metaStructure,
    metaObj.meta,
    metaObj.metaSize,
  );

  if (metaDataField) {
    metaDlfEncoder.field("meta", metaDataField);
  }

  return metaDlfEncoder.toUint8Array();
}

export function encodePolled(polledObj: PolledDlf): Uint8Array {
  const headerEncoder = createDataDlfHeaderEncoder();
  headerEncoder.get<DataType<typeof U16>>("magic").set(polledObj.magic);
  headerEncoder
    .get<DataType<typeof U8>>("streamType")
    .set(polledObj.streamType);
  headerEncoder.get<DataType<typeof U64>>("tickSpan").set(polledObj.tickSpan);
  headerEncoder
    .get<DataType<typeof U16>>("numStreams")
    .set(polledObj.streams.length);

  const polledDlfEncoder = Struct("PolledDlf").field("header", headerEncoder);

  for (const [idx, stream] of polledObj.streams.entries()) {
    const streamHeaderEncoder = createPolledStreamHeaderEncoder();
    streamHeaderEncoder
      .get<DataType<typeof NullTerminatedString>>("typeStructure")
      .set(stream.typeStructure);
    streamHeaderEncoder
      .get<DataType<typeof NullTerminatedString>>("id")
      .set(stream.id);
    streamHeaderEncoder
      .get<DataType<typeof NullTerminatedString>>("notes")
      .set(stream.notes);
    streamHeaderEncoder
      .get<DataType<typeof U32>>("typeSize")
      .set(stream.typeSize);
    streamHeaderEncoder
      .get<DataType<typeof U64>>("tickInterval")
      .set(stream.tickInterval);
    streamHeaderEncoder
      .get<DataType<typeof U64>>("tickPhase")
      .set(stream.tickPhase);

    polledDlfEncoder.field(`streamHeader${idx}`, streamHeaderEncoder);
  }

  for (const [idx, sample] of polledObj.samples.entries()) {
    const streamDef = polledObj.streams[sample.streamIdx];

    const sampleDataField = getEncoderField(
      streamDef.typeStructure,
      sample.buffer,
      streamDef.typeSize,
    );

    if (sampleDataField) {
      polledDlfEncoder.field(`sampleData${idx}`, sampleDataField);
    }
  }

  return polledDlfEncoder.toUint8Array();
}

export function encodeEvent(logObj: EventDlf): Uint8Array {
  const headerEncoder = createDataDlfHeaderEncoder();
  headerEncoder.get<DataType<typeof U16>>("magic").set(logObj.magic);
  headerEncoder.get<DataType<typeof U8>>("streamType").set(logObj.streamType);
  headerEncoder.get<DataType<typeof U64>>("tickSpan").set(logObj.tickSpan);
  headerEncoder
    .get<DataType<typeof U16>>("numStreams")
    .set(logObj.streams.length);

  const eventDlfEncoder = Struct("EventDlf").field("header", headerEncoder);

  for (const [idx, stream] of logObj.streams.entries()) {
    const streamHeaderEncoder = createEventStreamHeaderEncoder();
    streamHeaderEncoder
      .get<DataType<typeof NullTerminatedString>>("typeStructure")
      .set(stream.typeStructure);
    streamHeaderEncoder
      .get<DataType<typeof NullTerminatedString>>("id")
      .set(stream.id);
    streamHeaderEncoder
      .get<DataType<typeof NullTerminatedString>>("notes")
      .set(stream.notes);
    streamHeaderEncoder
      .get<DataType<typeof U32>>("typeSize")
      .set(stream.typeSize);

    eventDlfEncoder.field(`streamHeader${idx}`, streamHeaderEncoder);
  }

  for (const [idx, sample] of logObj.samples.entries()) {
    const sampleHeaderEncoder = createEventSampleHeaderEncoder();
    sampleHeaderEncoder
      .get<DataType<typeof U16>>("streamIdx")
      .set(sample.streamIdx);
    sampleHeaderEncoder
      .get<DataType<typeof U64>>("sampleTick")
      .set(sample.sampleTick);

    eventDlfEncoder.field(`sampleHeader${idx}`, sampleHeaderEncoder);

    const streamDef = logObj.streams[sample.streamIdx];
    const sampleDataField = getEncoderField(
      streamDef.typeStructure,
      sample.buffer,
      streamDef.typeSize,
    );

    if (sampleDataField) {
      eventDlfEncoder.field(`sampleData${idx}`, sampleDataField);
    }
  }

  return eventDlfEncoder.toUint8Array();
}

//#endregion

/**
 * `structure` describing a multi-field buffer is formatted like:
 *   "name;member_1_name:member_1_type:offset;...member_n_name:member_n_type:offset"
 * and `createParser` will return a Parser. Otherwise, `structure` describing a single
 * primitive is like:
 *   "double"
 * and `createParser` will return a string that contains the binary-parser method name.
 */
function createParser(
  structure: string,
  structureSize?: number,
): Parser | string | null {
  // No contained structure
  if (structure.startsWith("!")) {
    return null;
  }

  // To indicate a buffer that contains a single primitive value, return a string
  if (structure in BINARY_PARSERS_PRIMITIVES) {
    return BINARY_PARSERS_PRIMITIVES[
      structure as keyof typeof BINARY_PARSERS_PRIMITIVES
    ];
  }

  // Create parser for multi-field buffer
  // name;member_1:primitive_type:offset;...
  const [_name, ...members] = structure.split(";");

  let parser = new Parser()
    .endianness("little")
    // @ts-ignore
    .saveOffset("structureStartOffset");

  for (const member of members) {
    const [name, typeName, offset] = member.split(":");

    const relOff = parseInt(offset);
    const parserType =
      BINARY_PARSERS_PRIMITIVES[
        typeName as keyof typeof BINARY_PARSERS_PRIMITIVES
      ];

    parser = parser.pointer(name, {
      type: parserType,
      offset: function () {
        return this.structureStartOffset + relOff;
      },
    });
  }

  if (structureSize != null) {
    parser = parser.seek(structureSize);
  }

  return parser;
}

export abstract class Adapter {
  abstract get polledDlfBytes(): Promise<Uint8Array>;
  abstract get eventDlfBytes(): Promise<Uint8Array>;
  abstract get metaDlfBytes(): Promise<Uint8Array>;

  async getMetaDlf(): Promise<ParsedMetaDlf> {
    return metaDlfParser.parse(await this.metaDlfBytes);
  }

  async getMeta() {
    const parsed = await this.getMetaDlf();

    const parser = createParser(parsed.metaStructure, parsed.metaSize);
    if (!parser) {
      return null;
    }

    if (typeof parser === "string") {
      // metadata is a single primitive. We must manually create a Parser and
      // parse the buffer.
      // @ts-ignore
      return new Parser()[parser]("value").parse(parsed.meta).value;
    } else {
      return parser.parse(parsed.meta);
    }
  }

  async getPolledDlf(): Promise<ParsedDataDlf> {
    return dataDlfParser.parse(await this.polledDlfBytes);
  }

  async getEventDlf(): Promise<ParsedDataDlf> {
    return dataDlfParser.parse(await this.eventDlfBytes);
  }

  async getEventData(): Promise<
    Array<{ stream: Stream; streamIdx: number; tick: bigint; data: any }>
  > {
    const header = await this.getEventDlf();

    // Create choices
    const choices: Record<number, Parser | string | null> = {};
    for (const [i, stream] of header.streams.entries()) {
      choices[i] = createParser(stream.typeStructure, stream.typeSize);
    }

    const dataParser = new Parser().array("data", {
      readUntil: "eof",
      type: new Parser()
        .uint16le("streamIdx")
        .uint64le("sampleTick")
        .choice("data", {
          tag: "streamIdx",
          choices,
        }),
    });

    const { data } = dataParser.parse(header.data);

    return data.map(
      ({
        streamIdx,
        sampleTick,
        data,
      }: {
        streamIdx: number;
        sampleTick: bigint;
        data: any;
      }) => ({
        stream: header.streams[streamIdx],
        streamIdx,
        tick: sampleTick,
        data,
      }),
    );
  }

  async getPolledData(
    startTick = 0n,
    endTick: null | bigint = null,
  ): Promise<
    Array<{ stream: Stream; data: any; tick: bigint; offset: bigint }>
  > {
    // Read header
    const header = await this.getPolledDlf();
    // Note: stream order in the header is important because it dictates the order for data across
    // streams that exist on the same tick
    const streams: Stream[] = header.streams;

    // Build parsers for each stream
    const parsers = streams.map((s) => {
      const parser = createParser(s.typeStructure, s.typeSize);
      if (typeof parser === "string") {
        // @ts-ignore
        return new Parser()[parser]("data");
      }
      return new Parser().nest("data", {
        type: parser as Parser, // Handle complex structs
      });
    });

    // Pull out per-stream interval/phase/size values for convenience
    const streamInfos = streams.map((stream, index) => {
      const { tickInterval: interval, tickPhase: phase } =
        stream.streamInfo as { tickInterval: bigint; tickPhase: bigint };
      const size = BigInt(stream.typeSize);
      return {
        stream,
        index,
        interval,
        phase,
        size,
      };
    });

    const dataLen = BigInt(header.data.byteLength);
    const buf = header.data.buffer;
    const baseByteOffset = BigInt(header.data.byteOffset);

    // Seek byte offset to the start tick
    let offset = 0n;
    for (const streamInfo of streamInfos) {
      offset +=
        countBefore(startTick, streamInfo.interval, streamInfo.phase) *
        streamInfo.size;
    }
    if (offset >= dataLen) {
      return [];
    }

    // Initialize each stream's next due tick >= start
    const nextDue = streamInfos.map((streamInfo) =>
      nextDueAtOrAfter(startTick, streamInfo.interval, streamInfo.phase),
    );

    // Current tick is the minimum nextDue across all streams
    const minNextDue = () => nextDue.reduce((a, b) => (a < b ? a : b));
    let currentTick = minNextDue();

    const out: Array<{
      stream: Stream;
      data: any;
      tick: bigint;
      offset: bigint;
    }> = [];

    while (true) {
      if (endTick != null && currentTick >= endTick) {
        // We've reached the end of the range we care about (endTick)
        break;
      }

      // For this tick, consume payload bytes in header order for streams due now
      for (let streamIdx = 0; streamIdx < streamInfos.length; streamIdx++) {
        if (nextDue[streamIdx] !== currentTick) {
          // There's no data due at this tick for this stream
          continue;
        }

        const streamInfo = streamInfos[streamIdx];
        if (offset + streamInfo.size > dataLen) {
          // Unexpected EOF - data region cuts off earlier than expected
          return out;
        }

        // Parse data at this tick for this stream
        const decoded = parsers[streamInfo.index].parse(
          new Uint8Array(
            buf,
            Number(baseByteOffset + offset),
            Number(streamInfo.size),
          ),
        ).data;

        out.push({
          stream: streamInfo.stream,
          data: decoded,
          tick: currentTick,
          offset,
        });

        offset += streamInfo.size;
        nextDue[streamIdx] = currentTick + streamInfo.interval; // advance that stream
      }

      if (offset >= dataLen) {
        // Expected EOF - we've reached exactly the end of the data region
        break;
      }

      // Jump to next tick where any stream has data
      currentTick = minNextDue();
    }

    return out;
  }
}
