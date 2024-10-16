<script lang="ts">
    import { createEventDispatcher } from "svelte";
  import { polledRunEntries } from "../apiStores";
  import { runSelectModalOpen } from "../appStores";

  const dispatch = createEventDispatcher();

  function dispatchOpened(fileName: string) {
    dispatch("opened", fileName);
  }
</script>

{#each $polledRunEntries as [file_path, i]}
  <p>{file_path}, {i.name} <button class="btn" on:click={() => dispatchOpened(file_path)}>Set</button></p>
{/each}