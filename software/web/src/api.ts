import { cString, cStruct, float, uint32 } from "c-type-util";
import { url } from "./url";
import { getSourceType } from "./dataSourceTypes";
import { data_source_t, header_t, t_num_sources as num_sources_t } from "./headerTypes";
import { instantiateEmptyCType } from "./util";
import dot from "dot-object"

const URL_INDEX = url("/__INDEX");
const URL_ENTRIES = url("/__ENTRIES");
const URL_LIVE = url("/__LIVE");

export interface I__INDEX {
    [key: string]: {
        name: string,
        description: string,
        time_base: number,
        start_time: number,
        location: {
            longitude: number,
            latitude: number,
        }
    }
}

export type tChartDefinition = {
    chartName: string,
    chartType: string,
    sources: {
        [key: string]: {
            color: string,
            name: string
        }
    }
}

export type tHeaderSource = { cycle_interval: number, name: string, type_name: string };

export async function apiGetIndex(): Promise<I__INDEX> {
    const res = await fetch(URL_INDEX);

    // Transform the slightly weird JSON file into
    // something parsable. (remove last comma, wrap in curlies);
    const text = "{" + (await res.text()).replace(/,\s*$/g, "") + "}";
    return JSON.parse(text);
}

export async function apiGetSources(): Promise<tHeaderSource[]> {
    const res = await fetch(URL_ENTRIES);
    return apiParseSources(await res.arrayBuffer())[1];
}

export async function apiGetLive(sources: tHeaderSource[],): Promise<ArrayBuffer> {
    const res = await fetch(URL_LIVE);
    return res.arrayBuffer();
}

export function apiParseHeader(buf: ArrayBuffer) {
    let header = header_t.readLE(buf);

    let [sources_size, sources] = apiParseSources(buf.slice(header_t.size));

    let size = header_t.size + sources_size;

    return { ...header, sources, size } as typeof header & { sources: typeof sources, size: number };
}

export function apiParseSources(buf: ArrayBuffer): [number, tHeaderSource[]] {
    let num_sources = num_sources_t.readLE(buf);

    let sources = [];
    for (let i = num_sources_t.size; sources.length < num_sources; i += data_source_t.size) {
        sources.push(data_source_t.readLE(buf, i));
    }

    return [sources.length * data_source_t.size + num_sources_t.size, sources];
}

export function apiParseLiveData(buf: ArrayBuffer, sources: tHeaderSource[], dataContainer: tLoadedApiData) {
    let cType = cStruct(Object.fromEntries([
        ["__TIME", uint32],
        ...sources.map(s => [s.name, getSourceType(s.type_name)])
    ]));

    let dat = cType.readLE(buf);

    let flattenedNext = dot.dot(dat);

    for (let k in flattenedNext) {
        dataContainer[k].push(flattenedNext[k]);
    }
}

export type tSparseArray = (number | null)[];
export type tLoadedApiData = tSparseArray | { [key: string]: tLoadedApiData };
export type tLoadedApiDataContainer = {
    __TIME: number[],
    [key: string]: tSparseArray,
}

/**
 * From an array of sources, sets up a flattened data container
 * containing data stored under dot-notation paths, including data source names.
 * @param sources 
 * @param num_cycles 
 * @returns 
 */
export function setupDataContainer(sources: tHeaderSource[], num_cycles: number): tLoadedApiDataContainer {
    console.time("Container allocation");
    let dataContainer = {
        __TIME: null
    };
    for (const s of sources) {
        let ct = getSourceType(s.type_name)
        let dataStructure = instantiateEmptyCType(ct);
        dataContainer[s.name] = dataStructure;
    }

    dot.keepArray = true;
    const flatContainer = dot.dot(dataContainer);

    // Fill the container with nulls.
    for (let k in flatContainer) {
        flatContainer[k] = (new Array(num_cycles)).fill(null);
    }

    console.timeEnd("Container allocation");

    return flatContainer;
}


function mergeData(cycle: number, sourceName: string, data: any, dataContainer: tLoadedApiDataContainer) {
    let flattenedNext = dot.dot({ [sourceName]: data });

    for (let k in flattenedNext) {
        dataContainer[k][cycle] = flattenedNext[k];
    }
}

export function apiParseDataFile(buf: ArrayBuffer, head): tLoadedApiDataContainer {
    buf = buf.slice(head.size);

    let dataContainer = setupDataContainer(head.sources, head.num_cycles);

    console.time("Data file parsing");

    // Add some fields to the header's sources to prepare for parsing.
    let pe = head.sources.map(e => ({
        ...e,
        cycle: 0,
        source_type: getSourceType(e.type_name),
    }));

    let idx = 0, c = 0;

    while (idx < buf.byteLength) {
        // Try to parse each entry, if its interval is up
        for (let i = 0; i < pe.length; i++) {
            const e = pe[i];

            if (--e.cycle > 0) continue;


            const nextDat = e.source_type.readLE(buf, idx);

            mergeData(c, e.name, nextDat, dataContainer);

            e.cycle = e.cycle_interval;
            idx += e.source_type.size;
        }
        mergeData(c, "__TIME", c * head.cycle_time_base_ms / 1000, dataContainer)
        c++;
    }
    console.timeEnd("Data file parsing");

    return dataContainer;
}

function hash(buf: ArrayBuffer, len): number {
    buf = new Uint8Array(buf);
    let h = 5381;
    for (let i = len - 1; i >= 0; i--) {
        h = (h * 33 ^ buf[i]) & 0xFFFFFFFF;
    }
    return h;
}

