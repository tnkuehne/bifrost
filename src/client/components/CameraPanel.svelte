<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    compact?: boolean;
    hasStream: boolean;
    onStartCamera: () => void;
  };

  let { compact = false, hasStream, onStartCamera }: Props = $props();

  const buttonClass =
    "min-h-10 cursor-pointer rounded-md border border-line bg-panel-2 px-3.5 text-text disabled:cursor-not-allowed disabled:opacity-[0.55]";
  const primaryButtonClass = `${buttonClass} border-accent/55 bg-[#12825e]`;
  let rowClass = $derived(
    compact ? "grid grid-cols-1 gap-2.5" : "flex flex-wrap items-center gap-2",
  );
  let panelClass = $derived(compact ? "mt-[18px]" : "");
  let fullWidth = $derived(compact ? " w-full" : "");
</script>

<section class={panelClass}>
  {#if !compact}
    <h2 class="mt-6 text-sm uppercase tracking-normal text-muted">Camera</h2>
  {/if}
  <div class={rowClass}>
    {#if !hasStream}
      <button class={primaryButtonClass + fullWidth} type="button" onclick={onStartCamera}>
        Start Camera
      </button>
    {/if}
  </div>
</section>
