import { jsType } from "lightstruct";
export declare const stream_header_t: {
    members: import("lightstruct").structMembers<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
};
export declare const logfile_header_t: {
    members: import("lightstruct").structMembers<{
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
};
/************ polled.dlf ************/
export declare const polled_stream_header_t: {
    members: import("lightstruct").structMembers<{
        tick_interval: bigint;
        tick_phase: bigint;
    } & {
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        tick_interval: bigint;
        tick_phase: bigint;
    } & {
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        tick_interval: bigint;
        tick_phase: bigint;
    } & {
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        tick_interval: bigint;
        tick_phase: bigint;
    } & {
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
};
export type polled_stream_header_jst = jsType<typeof polled_stream_header_t>;
export declare const polled_logfile_header_t: {
    members: import("lightstruct").structMembers<{
        streams: import("lightstruct").OmitReferences<{
            tick_interval: any;
            tick_phase: any;
        } & {
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        streams: import("lightstruct").OmitReferences<{
            tick_interval: any;
            tick_phase: any;
        } & {
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        streams: import("lightstruct").OmitReferences<{
            tick_interval: any;
            tick_phase: any;
        } & {
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        streams: import("lightstruct").OmitReferences<{
            tick_interval: any;
            tick_phase: any;
        } & {
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
};
export type polled_logfile_header_jst = jsType<typeof polled_logfile_header_t>;
/************ events.dlf ************/
export declare const event_stream_header_t: {
    members: import("lightstruct").structMembers<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        type_id: string;
        id: string;
        notes: string;
        type_size: number;
    }>;
};
export type event_stream_header_jst = jsType<typeof event_stream_header_t>;
export declare const event_logfile_header_t: {
    members: import("lightstruct").structMembers<{
        streams: import("lightstruct").OmitReferences<{
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        streams: import("lightstruct").OmitReferences<{
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        streams: import("lightstruct").OmitReferences<{
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        streams: import("lightstruct").OmitReferences<{
            type_id: any;
            id: any;
            notes: any;
            type_size: any;
        }>[];
    } & {
        magic: number;
        stream_type: number;
        tick_span: bigint;
        num_streams: import("lightstruct").cTypeLengthReference;
    }>;
};
export type event_logfile_header_jst = jsType<typeof event_logfile_header_t>;
export declare const dlf_event_stream_sample_t: {
    members: import("lightstruct").structMembers<{
        stream: number;
        sample_tick: bigint;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        stream: number;
        sample_tick: bigint;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        stream: number;
        sample_tick: bigint;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        stream: number;
        sample_tick: bigint;
    }>;
};
/********* meta.dlf *********/
export declare const dlf_meta_header_t: {
    members: import("lightstruct").structMembers<{
        magic: number;
        tick_base_us: number;
        application: string;
        meta_size: number;
    }>;
    _read(destAST: import("estree").Pattern, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    _write(srcAST: import("estree").Expression, compiler: import("lightstruct").LightStructCompiler<unknown>): import("estree").Statement | import("estree").Program | (import("estree").Statement | import("estree").Statement[])[];
    readonly minSize: number;
    read(buf: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").readResult<{
        magic: number;
        tick_base_us: number;
        application: string;
        meta_size: number;
    }>;
    write(data: import("lightstruct").OmitReferences<{
        magic: number;
        tick_base_us: number;
        application: string;
        meta_size: number;
    }>, buffer?: ArrayBuffer | Uint8Array | DataView, offset?: number, isLE?: boolean): import("lightstruct").writeResult<{
        magic: number;
        tick_base_us: number;
        application: string;
        meta_size: number;
    }>;
};
export type dlf_meta_header_jst = jsType<typeof dlf_meta_header_t>;
