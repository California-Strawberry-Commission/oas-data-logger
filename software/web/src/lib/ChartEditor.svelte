<script lang="ts">
    import { createEventDispatcher } from "svelte";

    import { Plus, TrashSimple } from "phosphor-svelte";
    import AutoComplete from "simple-svelte-autocomplete";
    import Portal from "svelte-portal";
    import type { Readable } from "svelte/store";
    import { fade } from "svelte/transition";
    import type { tChartDefinition, tLoadedApiDataContainer } from "../api";
    import { getVar } from "../util";
    import Chart from "./Chart.svelte";

    export let dataStore: Readable<tLoadedApiDataContainer>;
    export let cursorSync: uPlot.SyncPubSub;
    export let definition: tChartDefinition;

    let localDefinition: tChartDefinition = JSON.parse(JSON.stringify(definition));
    $: sourceEntries = Object.entries(localDefinition.sources);
    $: allStoreKeys = Object.keys($dataStore);
    $: unselectedStoreKeys = Object.keys($dataStore).filter((k) => !sourceEntries.find(([k2, _]) => k2 == k) && k != "__TIME");

    const dispatch = createEventDispatcher();

    function addEntry() {
        sourceEntries = [...sourceEntries, [unselectedStoreKeys[0], { color: "#000", name: "new" }]];
    }

    function delEntry(entryName: string) {
        sourceEntries = sourceEntries.filter(([k, v]) => k != entryName);
    }

    function cancel() {
        dispatch("cancel");
    }

    function commit() {
        dispatch("commit", {
            ...definition,
            sources: Object.fromEntries(sourceEntries),
        });
    }
</script>

<Portal>
    <div class="modal modal-open" transition:fade={{ duration: 100 }}>
        <div class="modal-box w-11/12 max-w-full flex flex-col" style="height: 90%;">
            <h3 class="font-bold text-lg">Edit Chart</h3>
            <div class="flex-1 flex min-h-0">
                <div class="grid w-full grid-rows-[1fr_1fr] lg:grid-rows-none lg:grid-cols-[1fr_25rem] items-stretch">
                    <Chart {cursorSync} {dataStore} sources={Object.fromEntries(sourceEntries)} showLegend={false} gridColor={getVar("--b2")} />
                    <!-- Actions Container -->
                    <div class="flex flex-col gap-2 min-h-0 prose">
                        <h2>Chart Settings</h2>
                        <!-- Name -->
                        <div class="form-control gap-4">
                            <label class="input-group">
                                <span class="w-24">Name</span>
                                <input type="text" placeholder="New Run" class="input input-bordered w-full" bind:value={definition.chartName} />
                            </label>
                            <!-- <label class="input-group">
                                <span class="w-24">Desc</span>
                                <textarea class="textarea input-bordered w-full" />
                            </label> -->
                        </div>
                        <div class="divider">Series</div>
                        <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-[10rem]">
                            <div class="overflow-x-visible overflow-y-visible">
                                <table class="table w-full m-0">
                                    <thead>
                                        <tr>
                                            <th />
                                            <th>Data Path</th>
                                            <th>Color</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each sourceEntries as [src, srcopts]}
                                            <tr>
                                                <th class="px-0">
                                                    <button class="btn btn-ghost h-full" on:click={() => delEntry(src)}><TrashSimple size={16} /></button>
                                                </th>
                                                <td class:autocomplete-error={!allStoreKeys.includes(src)} class="autocomplete-error"
                                                    ><AutoComplete items={unselectedStoreKeys} bind:selectedItem={src} /></td
                                                >
                                                <td><input type="color" class="color-input" bind:value={srcopts.color} /></td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <btn class="btn btn-outline w-full" on:click={addEntry}><Plus size={16} /></btn>
                            </div>
                            <!--END-TABLE-->
                        </div>

                        <div class="inline-block self-end">
                            <button class="btn" on:click={cancel}>Cancel</button>
                            <button class="btn btn-primary" on:click={commit}>Save</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</Portal>

<style>
    table :global(.autocomplete) {
        border-color: hsl(var(--b3)) !important;
        position: relative !important;
    }

    table :global(.autocomplete-list) {
        position: absolute !important;
        top: 3rem !important;
        background-color: hsl(var(--b2)) !important;
    }

    table :global(.autocomplete-list-item:hover) {
        background-color: hsl(var(--b1)) !important;
    }

    .color-input {
        padding-bottom: 100%;
        width: 100%;
        background-color: inherit;
        position: relative;
    }
    .color-input::-webkit-color-swatch {
        margin: 0;
        border-radius: 0.5rem;
        border: none;
        background-color: inherit;
        padding-bottom: 100%;
        width: 100%;
        box-sizing: border-box;
        position: relative;
    }

    .autocomplete-error :global(.autocomplete-input) {
        color: hsl(var(--er)) !important;
    }

    /* .color-input::-moz-color-swatch {
        border-radius: 50%;
        border: 7px solid #000000;
        background-color: inherit;
        height: 100%;
    } */
</style>
