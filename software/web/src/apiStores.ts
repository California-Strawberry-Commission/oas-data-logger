import { derived, get, readable, writable, type Writable } from "svelte/store";
import { apiGetIndex, apiGetLive, apiGetSources, apiParseDataFile, apiParseHeader, apiParseLiveData, setupDataContainer, type tLoadedApiDataContainer } from "./api";
import { url as envUrl } from "./url";

// https://javascript.info/fetch-progress
// https://javascript.info/fetch-abort#:~:text=To%20be%20able%20to%20cancel,how%20to%20work%20with%20AbortController%20.

/**
 * Returns a readable store, populated with the results of the passed async function.
 * Used to 
 * @param fn - The function that produces data to be stored. Probably a function that performs a fetch 
 */
function polledReadable<T>(fn: () => Promise<T>, interval = 1000) {
    return readable<null | T>(null, set => {
        const update = async () => set(await fn());

        update(); // Perform an immediate update.

        // Poll for updates.
        const i = setInterval(update, interval)
        return () => clearInterval(i)
    });
};

export async function load(url: string, progress: Writable<number>, abortController: AbortController): Promise<ArrayBuffer> {
    let contentLen = 0;
    let rxLen = 0;

    if (url == null) return;

    progress.set(0);
    const res = await fetch(envUrl(url), { signal: abortController.signal, method: "get" });
    const reader = res.body.getReader();

    contentLen = +res.headers.get("Content-Length");

    const buf = new Uint8Array(contentLen);

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        buf.set(value, rxLen);
        rxLen += value.length;

        progress.set(rxLen / contentLen);
    }

    // https://stackoverflow.com/questions/37228285/uint8array-to-arraybuffer
    return buf.buffer.slice(buf.byteOffset, buf.byteLength + buf.byteOffset) as ArrayBuffer
}

export async function runDataStore(urlStore: Writable<string | null>, progressStore: Writable<number>, ac: AbortController): Promise<Writable<tLoadedApiDataContainer> | null> {
    let url = get(urlStore);
    if (url == null) return null;

    if (url == "/__LIVE") {
        let sources = await apiGetSources();
        let dataContainer = writable(setupDataContainer(sources, 0));


        async function poll() {
            let liveData = await apiGetLive(sources);
            console.log(liveData);
            dataContainer.update(d => {
                apiParseLiveData(liveData, sources, d);

                for (let k in d) {
                    if (d[k].length > 50) {
                        d[k].shift()
                    }
                }
                console.log(d);
                return d;
            });
            tout = setTimeout(poll, 500);
        }

        let tout = setTimeout(poll, 500);
        urlStore.subscribe(u => u == null ? clearTimeout(tout) : null);

        return dataContainer;
    } else {
        let rawDat = await load(url, progressStore, ac);
        console.log(rawDat)
        let header = apiParseHeader(rawDat);
        let parsedData = apiParseDataFile(rawDat, header);

        return writable(parsedData);
    }

}

export const polledRuns = polledReadable(apiGetIndex);
export const polledRunEntries = derived([polledRuns], ([$polledRuns]) => $polledRuns != null ? Object.entries($polledRuns) : [], []);
