/// <reference types="node" resolution-mode="require"/>
import { Adapter } from "./dlflib.js";
/**
 * Reads an unpacked run from disk. Useful for testing.
 */
export declare class FSAdapter extends Adapter {
    _rootDir: string;
    constructor(rootDir: string);
    get polled_dlf(): Promise<Buffer>;
    get events_dlf(): Promise<Buffer>;
    get meta_dlf(): Promise<Buffer>;
}
