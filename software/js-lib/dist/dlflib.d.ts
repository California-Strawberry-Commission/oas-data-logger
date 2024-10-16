/// <reference types="node" resolution-mode="require"/>
import { Parser } from "binary-parser";
/**
 * Creates an adapter to a remote, hosted, DLF Logfile
 */
export declare class LogClient {
    constructor(adapter: Adapter);
}
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
        stream_info: {
            tick_interval: number;
            tick_phase: number;
        } | {};
    }[];
    data: Uint8Array;
};
export declare abstract class Adapter {
    abstract get polled_dlf(): Promise<Uint8Array>;
    abstract get events_dlf(): Promise<Uint8Array>;
    abstract get meta_dlf(): Promise<Uint8Array>;
    create_parser(structure: string, structure_size?: number): Parser;
    /** From metafile **/
    meta_header(): Promise<{
        magic: number;
    } & {
        tick_base_us: number;
    } & {
        meta_structure: string;
    } & {
        meta_size: number;
    } & {
        meta: Buffer;
    }>;
    meta(): Promise<{}>;
    polled_header(): Promise<Tlogfile_header_t>;
    events_header(): Promise<Tlogfile_header_t>;
    events_data(): Promise<{
        stream: {
            type_id: string;
            type_structure: string;
            id: string;
            notes: string;
            type_size: number;
            stream_info: {} | {
                tick_interval: number;
                tick_phase: number;
            };
        };
        stream_idx: number;
        tick: bigint;
        data: never;
    }[]>;
    polled_data(start?: bigint, stop?: null | bigint, downsample?: bigint): Promise<any[]>;
    data(): Promise<any[] & {
        stream: {
            type_id: string;
            type_structure: string;
            id: string;
            notes: string;
            type_size: number;
            stream_info: {} | {
                tick_interval: number;
                tick_phase: number;
            };
        };
        stream_idx: number;
        tick: bigint;
        data: never;
    }[]>;
}
/**
 * Todo.
 * Takes a DLF run archive, unzips it, and holds it in memory for reading.
 */
/**
 * interacts with an unarchived run at a URL
 */
export declare class HTTPAdapter extends Adapter {
    _baseUrl: string;
    constructor(type_parsers: any, url: string);
    get polled_dlf(): Promise<ArrayBuffer>;
    get events_dlf(): Promise<ArrayBuffer>;
    get meta_dlf(): Promise<ArrayBuffer>;
}
export {};
