import { _minSize, cType, cTypeReadResult } from "lightstruct"
import { dlf_event_stream_sample_t, dlf_meta_header_jst, dlf_meta_header_t, event_logfile_header_t, polled_logfile_header_t } from "./dlfTypes"
/**
 * Creates an adapter to a remote, hosted, DLF Logfile 
 */
export class LogClient {
    constructor(adapter: Adapter) {

    }
}

export abstract class Adapter {
    _type_parsers;

    abstract get polled_dlf(): Promise<ArrayBuffer>;
    abstract get events_dlf(): Promise<ArrayBuffer>;
    abstract get meta_dlf(): Promise<ArrayBuffer>;

    constructor(type_parsers) {
        this._type_parsers = type_parsers;
    }

    /** From metafile **/
    async meta_header(): Promise<cTypeReadResult<dlf_meta_header_jst>> {
        return dlf_meta_header_t.read(await this.meta_dlf)
    }

    async meta<T>(meta_parsers: { [key: string]: cType<any> }): Promise<cTypeReadResult<T> | null> {
        const [metaHeader, metaHeaderSize] = await this.meta_header()
        const parser = meta_parsers[metaHeader.application];

        if (!parser) return null;

        return parser.read(await this.meta_dlf, dlf_meta_header_t[_minSize]())
    }

    async polled_header() {
        return polled_logfile_header_t.read(await this.polled_dlf)
    }

    async events_header() {
        return event_logfile_header_t.read(await this.events_dlf)
    }

    async events_data() {
        let [header, header_len] = await this.events_header()

        const abuf = await this.events_dlf;
        let blen = abuf.byteLength;

        for (let i = header_len; i < blen;) {
            const [sampleHeader, sampleHeaderLen] = dlf_event_stream_sample_t.read(abuf, i);
            i += sampleHeaderLen;

            const streamHeader = header.streams[sampleHeader.stream];

            const dataParser = this._type_parsers[streamHeader.type_id];
            const [data, dataLen] = dataParser.read(abuf, i)

            i += dataLen;

            console.log(sampleHeader, data);
        }
    }

    async polled_data(downsample = 1n) {
        let [header, headerLen] = (await this.polled_header())
        const abuf = await this.polled_dlf;
        let blen = abuf.byteLength;

        for (let i = headerLen, t = 0n; i < blen; t += downsample) {
            for (const stream of header.streams) {
                if ((t + stream.tick_phase) % stream.tick_interval != 0n)
                    continue;

                let tParser = this._type_parsers[stream.type_id];
                if (tParser) {
                    let [value, size] = tParser.read();
                } else {
                    console.warn("Unknown datatype found")
                }
                i += stream.type_size;

            }
        }
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
    _baseUrl: string;
    constructor(type_parsers, url: string) {
        super(type_parsers);
        this._baseUrl = url;
    }

    get polled_dlf() {
        return fetch(this._baseUrl + "/polled.dlf").then(r => r.arrayBuffer())
    }

    get events_dlf() {
        return fetch(this._baseUrl + "/event.dlf").then(r => r.arrayBuffer())
    }

    get meta_dlf() {
        return fetch(this._baseUrl + "/meta.dlf").then(r => r.arrayBuffer())
    }
}


