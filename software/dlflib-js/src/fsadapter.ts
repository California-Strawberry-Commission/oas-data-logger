import { readFile } from "fs/promises";
import { Adapter } from "./dlflib.js";
import { resolve } from "node:path";

/**
 * Reads an unpacked run from disk. Useful for testing.
 */
export class FSAdapter extends Adapter {
  _rootDir: string;

  constructor(rootDir: string) {
    super();
    this._rootDir = rootDir;
  }

  get metaDlfBytes() {
    return readFile(resolve(this._rootDir, "meta.dlf"));
  }

  get polledDlfBytes() {
    return readFile(resolve(this._rootDir, "polled.dlf"));
  }

  get eventDlfBytes() {
    return readFile(resolve(this._rootDir, "event.dlf"));
  }
}
