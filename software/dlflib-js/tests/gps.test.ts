import { expect, test } from "vitest";
import { Adapter } from "../src/dlflib";
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Parser } from "binary-parser"
import { FSAdapter } from "../src/fsadapter"

const a = new FSAdapter("tests/resources/gps");

test("Basic meta", async () => {
    expect(await a.meta_header()).toMatchObject({
        magic: 33812,
        tick_base_us: 100000,
        meta_size: 16,
        meta_id: "constexpr const char* t() [with T = loop()::lele]",
        meta_structure: "meta_struct;time:uint32_t:0;another:uint64_t:8",
    });

    expect(await a.meta()).toMatchObject({
        another: 5n,
        time: 0
    });
});

test("polled headers", async () => {
    expect(await a.polled_header()).toMatchObject({
        "magic": 33812,
        "num_streams": 0,
        "stream_type": 0,
        "streams": [],
        "tick_span": 1916n,
    });
});


test("event headers", async () => {
    expect(await a.events_header()).toMatchObject({
        "magic": 33812,
        "num_streams": 1,
        "stream_type": 1,
        "streams": [
            {
                "id": "GPSPos",
                "notes": "Notes...",
                "stream_info": {},
                "type_id": "constexpr const char* t() [with T = GPSPos]",
                "type_size": 24,
                "type_structure": "gps_pos;lat:double:0;lon:double:8;alt:double:16",
            },
        ],
        "tick_span": 1916n,
    });
});

test("Events data", async () => {
    console.log(await a.polled_data())
})