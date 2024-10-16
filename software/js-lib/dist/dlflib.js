import { Parser } from "binary-parser";
/**
 * Creates an adapter to a remote, hosted, DLF Logfile
 */
export class LogClient {
    constructor(adapter) {
    }
}
let binary_parsers_primitives = {
    "uint8_t": "uint8",
    "bool": "uint8",
    "uint16_t": "uint16le",
    "uint32_t": "uint32le",
    "uint64_t": "uint64le",
    "int8_t": "int8",
    "int16_t": "int16le",
    "int32_t": "int32le",
    "int64_t": "int64le",
    "float": "floatle",
    "double": "doublele",
};
const meta_header_t = new Parser()
    .endianness("little")
    .uint16("magic")
    .uint32("tick_base_us")
    .string("meta_structure", { zeroTerminated: true })
    .uint32("meta_size")
    .buffer("meta", { readUntil: "eof" });
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
        // @ts-ignore
        tag: function () { return this.$root.stream_type; },
        choices: {
            0: new Parser()
                .uint64le("tick_interval")
                .uint64le("tick_phase"), // polled
            1: new Parser(), // event
        }
    })
})
    .buffer("data", { readUntil: "eof" });
export class Adapter {
    // name;member_1_name:member_1_type:offset;...member_n_name:member_n_type:offset
    create_parser(structure, structure_size) {
        // No contained structure
        if (structure.startsWith("!"))
            return null;
        if (binary_parsers_primitives[structure]) {
            return binary_parsers_primitives[structure];
        }
        // Create parser
        // name;member_1:primitive_type:offset;...
        const [name, ...members] = structure.split(";");
        let member_parser = new Parser()
            .endianness("little")
            .saveOffset("_____off");
        for (const m of members) {
            const [name, type_name, offset] = m.split(":");
            const relOff = parseInt(offset);
            const bin_parse_type = binary_parsers_primitives[type_name];
            console.log("Member parser", name, bin_parse_type, relOff);
            member_parser = member_parser
                .pointer(name, {
                type: bin_parse_type, offset: function () {
                    return this.off + relOff;
                }
            });
            // member_parser = member_parser.pointer(name, { type: bin_parse_type, offset: off });
        }
        if (structure_size != null) {
            member_parser = member_parser.seek(structure_size);
        }
        return member_parser;
    }
    /** From metafile **/
    async meta_header() {
        return meta_header_t.parse(await this.meta_dlf);
    }
    async meta() {
        const mh = await this.meta_header();
        const meta_structure = mh.meta_structure;
        const metadata = mh.meta;
        const parser = this.create_parser(meta_structure, mh.meta_size, null);
        if (!parser)
            return null;
        return parser.parse(metadata);
    }
    async polled_header() {
        let polledDataFile = await this.polled_dlf;
        return logfile_header_t.parse(polledDataFile);
    }
    async events_header() {
        let eventDataFile = await this.events_dlf;
        return logfile_header_t.parse(eventDataFile);
    }
    async events_data() {
        let header = await this.events_header();
        // Create choices
        const choices = {};
        for (const [i, stream] of header.streams.entries()) {
            choices[i] = this.create_parser(stream.type_structure, stream.type_size);
        }
        const file_parser = new Parser()
            .array("data", {
            readUntil: "eof",
            type: new Parser()
                .uint16le("stream_idx")
                .uint64le("sample_tick")
                .choice("data", {
                tag: "stream_idx",
                choices
            })
        });
        const { data } = file_parser.parse(header.data);
        const merged_data = data.map(({ stream_idx, sample_tick, data }) => ({
            stream: header.streams[stream_idx],
            stream_idx,
            tick: sample_tick,
            data,
        }));
        return merged_data;
    }
    // Really, really awful code. Sorry... binary-parser has a kinda yucky api.
    async polled_data(start = 0n, stop = null, downsample = 1n) {
        start = BigInt(start);
        if (stop != null)
            stop = BigInt(stop);
        downsample = BigInt(downsample) || 1n;
        let header = await this.polled_header();
        const createParser = (s) => {
            let t = this.create_parser(s.type_structure, s.type_size);
            if (typeof t == "string") {
                return new Parser()[t]("data");
            }
            else {
                return new Parser().nest("data", {
                    type: "uint32le"
                });
            }
        };
        const mapEntries = header.streams.map(s => [s, createParser(s)]);
        let headerParsers = new Map(mapEntries);
        function getNearestByteOffset(tick, stream) {
            let interval = BigInt(stream.stream_info.tick_interval);
            let phase = BigInt(stream.stream_info.tick_phase);
            let size = BigInt(stream.type_size);
            if ((tick % interval) != 0n) {
                return null;
            }
            //tick = (tick / interval) * interval;
            // Formula: sum (ceil((tick+phase) / interval) * size) 
            let block_start = 0n;
            let target_found = false;
            for (const s of header.streams) {
                let interval = BigInt(s.stream_info.tick_interval);
                let phase = BigInt(s.stream_info.tick_phase);
                let size = BigInt(s.type_size);
                // Add contribution to base offset
                block_start += ((tick + phase) / interval + (tick % interval ? 1n : 0n)) * size;
                // calculate offset within base block offset
                target_found || (target_found = s == stream);
                if (!target_found && ((tick + phase) % interval == 0n)) {
                    block_start += size;
                }
            }
            return block_start;
        }
        let abuf = header.data;
        let data = []; // tick: {values}
        for (let tick = start; (stop == null || tick < stop) && (tick < BigInt(header.tick_span)); tick += downsample) {
            for (const [stream, parser] of headerParsers.entries()) {
                let o = getNearestByteOffset(tick, stream);
                if (o == null)
                    continue;
                if (BigInt(stream.type_size) + o > header.data.byteLength)
                    break;
                data.push({
                    stream,
                    data: parser.parse(new Uint8Array(header.data.buffer, Number(o) + header.data.byteOffset)).data,
                    tick,
                    o
                });
            }
        }
        return data;
    }
    async data() {
        return Object.assign({}, await this.polled_data(), await this.events_data());
    }
}
/**
 * Todo.
 * Takes a DLF run archive, unzips it, and holds it in memory for reading.
 */
// export class ArchiveAdapter extends Adapter {
// }
/**
 * interacts with an unarchived run at a URL
 */
export class HTTPAdapter extends Adapter {
    constructor(type_parsers, url) {
        super(type_parsers);
        this._baseUrl = url;
    }
    get polled_dlf() {
        return fetch(this._baseUrl + "/polled.dlf").then(r => r.arrayBuffer());
    }
    get events_dlf() {
        return fetch(this._baseUrl + "/event.dlf").then(r => r.arrayBuffer());
    }
    get meta_dlf() {
        return fetch(this._baseUrl + "/meta.dlf").then(r => r.arrayBuffer());
    }
}
