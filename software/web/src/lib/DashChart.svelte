<script lang="ts">
    import { CaretRight, MagnifyingGlass, PencilSimple, TrashSimple } from "phosphor-svelte";
    import Portal from "svelte-portal";
    import type { Readable } from "svelte/store";
    import { fade } from "svelte/transition";
    import type { tChartDefinition, tLoadedApiDataContainer } from "../api";
    import { getVar } from "../util";
    import Chart from "./Chart.svelte";
    import ChartEditor from "./ChartEditor.svelte";
    import { createEventDispatcher } from "svelte";

    export let dataStore: Readable<tLoadedApiDataContainer>;
    export let cursorSync: uPlot.SyncPubSub;

    export let data: { sources: { [key: string]: { color: string; name: string } }; chartName: string; chartType: string };

    let legendContainer;

    let dispatch = createEventDispatcher();

    // let testDataDef: tChartDefinition = {
    //     sources: {
    //         data1: {
    //             color: "#000",
    //             name: "Custom data1 label",
    //         },
    //         data2: {
    //             color: "#000",
    //             name: "Custom data2 label",
    //         },
    //     },
    //     chartName: "Chart",
    //     chartType: "line",
    // };

    let isEditing = false;
    let isZooming = false;

    function setZooming(state) {
        isZooming = state;
    }

    function setEditing(state) {
        isEditing = state;
    }

    function saveEdits({ detail }) {
        setEditing(false);
        dispatch("commit", detail);
    }

    function cancelEdits() {
        setEditing(false);
    }

    function deleteChart() {
        dispatch("delete");
    }
</script>

<!-- Grid Card Contents-->
<div class="w-full h-full flex flex-col overflow-hidden">
    <div class="flex justify-between prose w-auto max-w-none max-h-14">
        <div class="flex items-center gap-2 overflow-visible relative">
            <div class="bg-base-300 flex items-center gap-2 px-3 m-0 py-2 rounded-br-2xl cursor-move select-none h-full z-10 revealer">
                <h3 class="m-0 text-neutral-content">{data.chartName || "Unnamed Chart"}</h3>
                <CaretRight color="hsl(var(--nc))" />
            </div>

            <div class="actions bg-base-300 flex px-3 m-0 py-2 rounded-br-2xl cursor-move select-none h-full absolute left-0 pl-[100%] w-auto top-0">
                <button class="btn btn-ghost btn-sm loc-hidden" on:pointerdown|stopPropagation on:click={() => setEditing(true)}
                    ><PencilSimple size={24} color="hsl(var(--nc))" /></button
                >
                <button class="btn btn-ghost btn-sm loc-hidden" on:pointerdown|stopPropagation on:click={() => setZooming(true)}
                    ><MagnifyingGlass size={24} color="hsl(var(--nc))" /></button
                >
                <button class="btn btn-ghost btn-sm loc-hidden" on:pointerdown|stopPropagation on:click={deleteChart}
                    ><TrashSimple size={24} color="hsl(var(--nc))" /></button
                >
            </div>
        </div>

        <div on:pointerdown|stopPropagation bind:this={legendContainer} />
    </div>
    <Chart {cursorSync} {dataStore} {legendContainer} sources={data.sources} />
</div>

<!-- Card Edit Modal -->
{#if isEditing}
    <ChartEditor definition={data} {cursorSync} {dataStore} on:cancel={cancelEdits} on:commit={saveEdits} />
{/if}

{#if isZooming}
    <Portal>
        <div class="modal modal-open" transition:fade={{ duration: 100 }}>
            <div class="modal-box w-full max-w-full h-full max-h-full flex flex-col rounded-none">
                <button class="btn btn-sm btn-circle absolute right-2 top-2" on:click={() => setZooming(false)}>✕</button>
                <h3 class="font-bold text-lg">{data.chartName}</h3>
                <div class="flex-1 flex min-h-0">
                    <Chart {cursorSync} {dataStore} sources={data.sources} showLegend={true} gridColor={getVar("--b2")} />
                </div>
            </div>
        </div>
    </Portal>
{/if}

<style>
    .actions {
        opacity: 0;
        visibility: hidden;
        transition-property: opacity;
        transition-duration: 100ms;
        transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }

    .revealer:hover + .actions {
        visibility: visible;
        opacity: 1;
    }

    .actions:hover {
        visibility: visible;
        opacity: 1;
    }
</style>
