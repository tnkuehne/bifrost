<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Mode } from "../types";

  type Props = {
    mode: Mode;
    debug: boolean;
    remoteVideoVisible: boolean;
    stage: Snippet;
    panel: Snippet;
  };

  let { mode, debug, remoteVideoVisible, stage, panel }: Props = $props();
</script>

{#if mode === "obs"}
  <main class="block min-h-screen overflow-hidden bg-black text-text">
    {@render stage()}
  </main>
{:else if debug}
  <main
    class="grid min-h-screen grid-cols-[minmax(0,1fr)_390px] bg-bg text-text max-[900px]:grid-cols-1"
  >
    {@render stage()}
    <aside
      class="min-h-screen overflow-auto border-l border-line bg-panel p-[22px] max-[900px]:min-h-0 max-[900px]:border-t max-[900px]:border-l-0"
    >
      {@render panel()}
    </aside>
  </main>
{:else if mode === "camera"}
  <main
    class="flex min-h-screen flex-col items-center justify-center gap-[18px] bg-bg px-[18px] pt-[max(22px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] text-text"
  >
    {@render stage()}
    <aside class="order-1 min-h-0 w-[min(100%,390px)] overflow-visible bg-transparent p-0">
      {@render panel()}
    </aside>
  </main>
{:else if remoteVideoVisible}
  <main class="grid min-h-screen place-items-center bg-bg text-text">
    {@render stage()}
    <aside
      class="fixed right-4 bottom-4 max-h-[calc(100vh-32px)] w-[min(420px,calc(100vw-32px))] overflow-auto rounded-lg border border-line bg-panel/88 p-[22px] shadow-panel backdrop-blur-[10px]"
    >
      {@render panel()}
    </aside>
  </main>
{:else}
  <main class="grid min-h-screen place-items-center bg-bg text-text">
    {@render stage()}
    <aside
      class="mx-auto min-h-0 w-[min(100%,390px)] overflow-visible bg-transparent px-[22px] py-[34px]"
    >
      {@render panel()}
    </aside>
  </main>
{/if}
