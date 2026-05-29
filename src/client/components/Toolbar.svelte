<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    title: string;
    debug: boolean;
    compact: boolean;
    onToggleDebug: () => void;
  };

  let { title, debug, compact, onToggleDebug }: Props = $props();
</script>

<div
  class={compact
    ? "mb-3 flex flex-wrap items-center justify-between gap-2"
    : "flex flex-wrap items-center justify-between gap-2"}
>
  <h1 class={compact ? "m-0 text-[22px] leading-tight" : "m-0 text-2xl leading-tight"}>
    {title}
  </h1>
  <button
    class="min-h-10 cursor-pointer rounded-md border border-line bg-panel-2 px-3.5 text-text disabled:cursor-not-allowed disabled:opacity-[0.55]"
    type="button"
    onclick={onToggleDebug}
  >
    {debug ? "Normal" : "Debug"}
  </button>
</div>
