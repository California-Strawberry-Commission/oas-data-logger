<script lang="ts">
    import type { Readable } from "svelte/store";
    import gridHelp from "svelte-grid/build/helper";
    import Grid from "svelte-grid";
    import type { tLoadedApiData, tLoadedApiDataContainer } from "../api";
    import { createEventDispatcher } from "svelte";
    import DashChart from "./DashChart.svelte";
    import uPlot from "uplot";
    import { X as CloseIcon, CaretDown } from "phosphor-svelte";
    import { fade } from "svelte/transition";
    import AutoComplete from "simple-svelte-autocomplete";

    export let dataStore: Readable<tLoadedApiDataContainer>;
    export let dashIndex: number;

    let dispatch = createEventDispatcher();

    type tDashboardDefinition = {
        name: string;
        author: string;
        items: any[];
        gridIds: number;
    };

    function dispatchExit() {
        dispatch("exit");
    }

    let dashboards: tDashboardDefinition[] = JSON.parse(localStorage.getItem("DASH_CONFIGS")) ?? [];

    let selectedDashboard: tDashboardDefinition | null = dashboards[dashIndex];
    $: dashIndex = dashboards.indexOf(selectedDashboard);

    let cursorSync = uPlot.sync("main");

    function createGraph() {
        if (!selectedDashboard) return;
        let newItem = {
            6: gridHelp.item({
                w: 2,
                h: 2,
                x: 0,
                y: 0,
            }),
            id: selectedDashboard.gridIds++,
            data: {
                sources: {},
                chartName: "New Chart",
                chartType: "line",
            },
        };

        newItem = {
            ...newItem,
            6: {
                ...newItem[6],
                ...gridHelp.findSpace(newItem, selectedDashboard.items, 6),
            },
        };
        selectedDashboard.items = [...[newItem], ...selectedDashboard.items];
    }

    function createDashboard(name, author) {
        dashboards = [{ author, name, items: [], gridIds: 0 }, ...dashboards];
        selectedDashboard = dashboards[0];
        commitLocalstorage();
    }

    function commitChartEdits(itemIdx, data) {
        selectedDashboard.items[itemIdx].data = data;
    }

    function deleteChart(idx: number) {
        selectedDashboard.items = selectedDashboard.items.filter((_, i) => i != idx);
    }

    $: selectedDashboard, commitLocalstorage();

    function commitLocalstorage() {
        console.log("COMMITING");
        localStorage.setItem("DASH_CONFIGS", JSON.stringify(dashboards));
    }

    const cols = [[1200, 6]];
</script>

<!-- Header -->
<div class="navbar shadow-lg bg-base-300 rounded-box m-3 w-auto flex justify-between">
    <div class="min-w-0 flex gap-4">
        <AutoComplete items={dashboards} labelFieldName="name" bind:selectedItem={selectedDashboard} />
        <button class="btn" on:click={() => createDashboard("new", "auth")}>Add</button>
        <button class="btn">Delete</button>
    </div>
    <div class="px-2 mx-2">
        <span class="text-lg font-bold"> ESPDAQ 2023 </span>
    </div>
    <div class="min-w-0 flex gap-4">
        <button class="btn" on:click={createGraph}>Add Chart</button>
        <button class="btn btn-square btn-ghost btn-error" on:click={dispatchExit}>
            <CloseIcon size="32" />
        </button>
    </div>
</div>

<!-- Dashboard -->
<div class="overflow-y-scroll flex-1">
    <div class="min-w-0 lg:max-w-full max-w-[95%]">
        {#if selectedDashboard}
            <Grid
                gap={[10, 5]}
                bind:items={selectedDashboard.items}
                {cols}
                rowHeight={100}
                let:item
                let:dataItem
                let:movePointerDown
                let:index
                throttleUpdate={500}
                throttleResize={500}
            >
                <div class="card card-bordered bg-base-200 h-full overflow-hidden">
                    <div class="card-body h-full p-0 overflow-hidden">
                        <DashChart
                            {cursorSync}
                            {dataStore}
                            data={dataItem?.data}
                            on:commit={({ detail }) => commitChartEdits(index, detail)}
                            on:delete={() => deleteChart(index)}
                        />
                    </div>
                </div>
            </Grid>
        {/if}
    </div>
</div>

<style>
    :global(.svlt-grid-shadow) {
        background: hsl(var(--nc)) !important;
        border-radius: 1rem;
    }

    :global(.input-container) {
        height: 100%;
        width: 100%;
        padding: 0;
        align-items: center;
    }
</style>
