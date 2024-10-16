import { readFile } from "fs/promises";
import { Adapter } from "./dlflib.js";
import { resolve } from "node:path";
/**
 * Reads an unpacked run from disk. Useful for testing.
 */
export class FSAdapter extends Adapter {
    constructor(rootDir) {
        super();
        this._rootDir = rootDir;
    }
    get polled_dlf() {
        return readFile(resolve(this._rootDir, "polled.dlf"));
    }
    get events_dlf() {
        return readFile(resolve(this._rootDir, "event.dlf"));
    }
    get meta_dlf() {
        return readFile(resolve(this._rootDir, "meta.dlf"));
    }
}
