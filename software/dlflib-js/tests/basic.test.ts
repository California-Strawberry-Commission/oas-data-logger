import { expect, test } from "vitest";
import { Adapter } from "../src/dlflib";
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Parser } from "binary-parser"
import { FSAdapter } from "../src/fsadapter"
export function readRes<T>(value: T, size: number) {
    return [value, size];
}

export function writeRes<T>(buffer: T, size: number) {
    return [buffer, size];
}



const a = new FSAdapter("tests/resources/basic");

test("Basic meta", async () => {
    expect(await a.meta_header()).toMatchObject({
        magic: 33812,
        tick_base_us: 100000,
        meta_size: 16,
        meta_structure: "run_meta;time:uint32_t:0;another:uint64_t:8",
    });

    // expect(await a.meta()).toMatchObject({
    //     another: 9523124174940276194n,
    //     time: 1061160418
    // });
});

test("polled headers", async () => {
    expect(await a.polled_header()).toMatchObject({
        "magic": 33812,
        "num_streams": 3,
        "stream_type": 0,
        "streams": [
            {
                "id": "l",
                "notes": "position latitude (polled)",
                "stream_info": {
                    "tick_interval": 10n,
                    "tick_phase": 0n,
                },
                "type_size": 8,
                "type_structure": "double",
            },
            {
                "id": "pos.lon",
                "notes": "position longitude",
                "stream_info": {
                    "tick_interval": 10n,
                    "tick_phase": 1n,
                },
                "type_size": 4,
                "type_structure": "uint32_t",
            },
            {
                "id": "pos.alt",
                "notes": "N/A",
                "stream_info": {
                    "tick_interval": 10n,
                    "tick_phase": 0n,
                },
                "type_size": 4,
                "type_structure": "uint32_t",
            },
        ],
        "tick_span": 34n,
    });
});


test("event headers", async () => {
    expect(await a.events_header()).toMatchObject({
        "magic": 33812,
        "num_streams": 3,
        "stream_type": 1,
        "streams": [
            {
                "id": "pos.lat",
                "notes": "N/A",
                "stream_info": {},
                "type_size": 4,
                "type_structure": "uint32_t",
            },
            {
                "id": "pos.lon",
                "notes": "N/A",
                "stream_info": {},
                "type_size": 4,
                "type_structure": "uint32_t",
            },
            {
                "id": "pos.alt",
                "notes": "N/A",
                "stream_info": {},
                "type_size": 4,
                "type_structure": "uint32_t",
            },
        ],
        "tick_span": 34n,
    });
});

// test("Events data", async () => {
//     console.log(await a.events_data())
// })

test("Polled data", async () => {
    console.log(await a.polled_data(0n, 50n))
})