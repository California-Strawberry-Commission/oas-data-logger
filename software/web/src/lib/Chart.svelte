<script lang="ts">
    import { get, type Readable } from "svelte/store";
    import uPlot from "uplot";
    import { dotNotationLookup, mapDotNotations } from "../util";
    import { onDestroy, onMount } from "svelte";
    import type { tLoadedApiDataContainer } from "../api";
    import { getVar } from "../util";

    export let showLegend = true;
    export let dataStore: Readable<tLoadedApiDataContainer>;
    export let cursorSync: uPlot.SyncPubSub;
    export let sources;
    export let legendContainer = null;

    export let gridColor = getVar("--b1");

    let chartContainer;
    let plt: uPlot | null = null;
    let unsubPlt;

    let clientH, clientW;

    $: {
        plt?.setSize({
            height: clientH || 100,
            width: clientW || 100,
        });
    }

    function getSeries(sourceEntries) {
        let dataSeries = sourceEntries.map(([k, v]: [any, any]) => ({ label: k, stroke: v.color, spanGaps: true }));
        return [{ label: "x" }, ...dataSeries];
    }

    function resolveData(sources, data) {
        // Map sources to their data, then filter for existing data.
        const validSourceEntries = Object.entries(sources).filter(([k, v]) => data[k] != null);

        const seriesData = [data.__TIME, ...validSourceEntries.map(([k, v]) => data[k])];
        const series = getSeries(validSourceEntries);

        return {
            data: seriesData,
            series,
        };
    }

    function initPlot(sources, chartContainer, legendContainer, cursorSync) {
        if (sources == null || chartContainer == null) return;

        // If re-running initPlot (ie sources changed)
        // just recreate the plot. No reason to bother
        // syncing or anything.
        // NOTE: This is TERRIBLE for performance.
        // Make sure to limit calls that update sources.
        if (plt) plt.destroy();
        if (unsubPlt) unsubPlt();

        let sourceData = get(dataStore);

        const { data, series } = resolveData(sources, sourceData);
        //console.log(data, sources, chartContainer, legendContainer, cursorSync);

        const matchSyncKeys = (own, ext) => own == ext;
        plt = new uPlot(
            {
                cursor: {
                    sync: {
                        key: cursorSync.key,
                        setSeries: true,
                        match: [matchSyncKeys, matchSyncKeys],
                    },
                    points: {
                        size: 7,
                    },
                },
                focus: {
                    alpha: 0.3,
                },
                width: clientW,
                height: clientH,
                scales: { x: { time: false } },
                axes: [
                    {
                        stroke: getVar("--bc"),
                        grid: { stroke: gridColor },
                    },
                    {
                        stroke: getVar("--bc"),
                        grid: { stroke: gridColor },
                    },
                ],
                legend: {
                    mount(up, el) {
                        if (legendContainer) legendContainer.appendChild(el);
                    },
                    show: showLegend,
                },
                series,
            },
            data,
            chartContainer
        );
        cursorSync.sub(plt);

        // Update the graph when new data comes in.
        // Note: DON'T use the incoming data object. The
        // captured one will be updated because it holds
        // references to the data arrays. Just need to make the
        // plot refresh.
        unsubPlt = dataStore.subscribe(() => {
            plt.setData(data);
        });
    }

    let throttleTout = null;
    function throttledPlotInit(sources, chartContainer, legendContainer, cursorSync) {
        if(throttleTout) clearTimeout(throttleTout);
        throttleTout = setTimeout(() => {
            initPlot(sources, chartContainer, legendContainer, cursorSync);
            throttleTout = null;
        }, 50)
    }

    // Reactive statement that initializes the plot when any of args change.
    // Mainly concerned with `sources`
    $: throttledPlotInit(sources, chartContainer, legendContainer, cursorSync);

    onDestroy(() => {
        if (unsubPlt) unsubPlt();
        plt?.destroy();
    });
</script>

<div class="flex-1 box-border overflow-hidden" bind:this={chartContainer} bind:clientHeight={clientH} bind:clientWidth={clientW} on:pointerdown|stopPropagation />
