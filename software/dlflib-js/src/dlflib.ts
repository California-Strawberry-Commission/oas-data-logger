import { Parser } from "binary-parser";

/**
 * Creates an adapter to a remote, hosted, DLF Logfile
 */
export class LogClient {
  constructor(adapter: Adapter) {}
}

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

const meta_header_t = new Parser()
  .endianness("little")
  .uint16("magic")
  .uint32("epoch_time_s")
  .uint32("tick_base_us")
  .string("meta_structure", { zeroTerminated: true })
  .uint32("meta_size")
  .buffer("meta", { readUntil: "eof" });

type Tlogfile_header_t = {
  magic: number;
  stream_type: number;
  tick_span: BigInt;
  num_streams: number;
  streams: {
    type_id: string;
    type_structure: string;
    id: string;
    notes: string;
    type_size: number;
    stream_info:
      | {
          tick_interval: number;
          tick_phase: number;
        }
      | {};
  }[];
  data: Uint8Array;
};

const logfile_header_t = new Parser()
  // @ts-ignore
  .useContextVars()
  .endianness("little")
  .uint16("magic")
  .uint8("stream_type")
  .uint64("tick_span")
  .uint16("num_streams")
  .array("streams", {
    length: "num_streams",
    type: new Parser()
      .string("type_structure", { zeroTerminated: true })
      .string("id", { zeroTerminated: true })
      .string("notes", { zeroTerminated: true })
      .uint32le("type_size")
      .choice("stream_info", {
        tag: function () {
          // $root references the root structure
          // @ts-ignore
          return this.$root.stream_type;
        },
        choices: {
          0: new Parser().uint64le("tick_interval").uint64le("tick_phase"), // polled
          1: new Parser(), // event
        },
      }),
  })
  .buffer("data", { readUntil: "eof" });

type Stream = Tlogfile_header_t["streams"][0];

export abstract class Adapter {
  abstract get polled_dlf(): Promise<Uint8Array>;
  abstract get events_dlf(): Promise<Uint8Array>;
  abstract get meta_dlf(): Promise<Uint8Array>;

  // `structure` describing a multi-field buffer is formatted like:
  //    "name;member_1_name:member_1_type:offset;...member_n_name:member_n_type:offset"
  // and `create_parser` will return a Parser. Otherwise, `structure` describing
  // a single primitive is like:
  //    "double"
  // and `create_parser` will return a string that contains the binary-parser method.
  create_parser(
    structure: string,
    structure_size?: number
  ): Parser | string | null {
    // No contained structure
    if (structure.startsWith("!")) {
      return null;
    }

    // To indicate a buffer that contains a single primitive value, return a string
    if (structure in BINARY_PARSERS_PRIMITIVES) {
      return BINARY_PARSERS_PRIMITIVES[structure];
    }

    // Create parser for multi-field buffer
    // name;member_1:primitive_type:offset;...
    const [name, ...members] = structure.split(";");

    let parser = new Parser()
      .endianness("little")
      // @ts-ignore
      .saveOffset("_____off");

    for (const m of members) {
      const [name, type_name, offset] = m.split(":");

      const relOff = parseInt(offset);
      const parserType = BINARY_PARSERS_PRIMITIVES[type_name];

      console.log("Member parser", name, parserType, relOff);

      parser = parser.pointer(name, {
        type: parserType,
        offset: function () {
          return this.off + relOff;
        },
      });
    }

    if (structure_size != null) {
      parser = parser.seek(structure_size);
    }

    return parser;
  }

  /** From metafile **/
  async meta_header() {
    return meta_header_t.parse(Buffer.from(await this.meta_dlf));
  }

  async meta() {
    const mh = await this.meta_header();

    const parser = this.create_parser(mh.meta_structure, mh.meta_size);
    if (!parser) {
      return null;
    }

    if (typeof parser === "string") {
      // metadata is a single primitive. We must manually create a Parser and
      // parse the buffer.
      // @ts-ignore
      return new Parser()[parser]("value").parse(mh.meta).value;
    } else {
      return parser.parse(mh.meta);
    }
  }

  async polled_header(): Promise<Tlogfile_header_t> {
    const polledDataFile = await this.polled_dlf;
    return logfile_header_t.parse(polledDataFile);
  }

  async events_header(): Promise<Tlogfile_header_t> {
    const eventDataFile = await this.events_dlf;
    return logfile_header_t.parse(eventDataFile);
  }

  async events_data() {
    const header = await this.events_header();

    // Create choices
    const choices = {};
    for (const [i, stream] of header.streams.entries()) {
      choices[i] = this.create_parser(stream.type_structure, stream.type_size);
    }

    const file_parser = new Parser().array("data", {
      readUntil: "eof",
      type: new Parser()
        .uint16le("stream_idx")
        .uint64le("sample_tick")
        .choice("data", {
          tag: "stream_idx",
          choices,
        }),
    });

    const { data } = file_parser.parse(Buffer.from(header.data));

    const merged_data = data.map(({ stream_idx, sample_tick, data }) => ({
      stream: header.streams[stream_idx],
      stream_idx,
      tick: sample_tick,
      data,
    }));

    return merged_data;
  }

  async polled_data(startTick = 0n, endTick: null | bigint = null) {
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

    // Read header
    const header = await this.polled_header();
    // Note: stream order in the header is important because it dictates the order for data across
    // streams that exist on the same tick
    const streams: Stream[] = header.streams;

    // Build parsers for each stream
    const parsers = streams.map((s) => {
      const parser = this.create_parser(s.type_structure, s.type_size);
      if (typeof parser === "string") {
        // @ts-ignore
        return new Parser()[parser]("data");
      }
      return new Parser().nest("data", {
        // @ts-ignore
        type: "uint32le",
      });
    });

    // Pull out per-stream interval/phase/size values for convenience
    const streamInfos = streams.map((stream, index) => {
      const interval = BigInt((stream as any).stream_info.tick_interval);
      const phase = BigInt((stream as any).stream_info.tick_phase);
      const size = BigInt(stream.type_size);
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
      nextDueAtOrAfter(startTick, streamInfo.interval, streamInfo.phase)
    );

    // Current tick is the minimum nextDue across all streams
    const minNextDue = () => nextDue.reduce((a, b) => (a < b ? a : b));
    let currentTick = minNextDue();

    const out: any[] = [];

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
            Number(streamInfo.size)
          )
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

  async data() {
    return Object.assign(
      {},
      await this.polled_data(),
      await this.events_data()
    );
  }
}
