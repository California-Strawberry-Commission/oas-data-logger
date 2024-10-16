import { url } from "../url";

const URL_INDEX = url("/__INDEX");
const URL_ENTRIES = url("/__ENTRIES");
const URL_LIVE = url("/__LIVE");

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