<svelte:options runes={true} />

<script lang="ts">
  import type { StatusKind } from "../types";

  type Props = {
    kind?: StatusKind;
    title: string;
    detail?: string;
    compact?: boolean;
  };

  let { kind = "waiting", title, detail = "", compact = false }: Props = $props();

  let statusClass = $derived(
    compact
      ? "grid grid-cols-[12px_minmax(0,1fr)] items-start gap-2.5 bg-transparent p-0"
      : "grid grid-cols-[12px_minmax(0,1fr)] items-start gap-2.5 rounded-lg border border-line bg-white/[0.035] p-3",
  );
  let dotClass = $derived(
    kind === "good"
      ? "mt-[5px] h-2.5 w-2.5 animate-[status-good_1.7s_ease-in-out_infinite] rounded-full bg-accent shadow-[0_0_0_4px_rgb(52_211_153_/_0.13)]"
      : kind === "bad"
        ? "mt-[5px] h-2.5 w-2.5 rounded-full bg-bad shadow-[0_0_0_4px_rgb(251_113_133_/_0.13)]"
        : "mt-[5px] h-2.5 w-2.5 animate-[status-search_1.45s_ease-in-out_infinite] rounded-full bg-warn shadow-[0_0_0_4px_rgb(251_191_36_/_0.13)]",
  );
</script>

<div class={statusClass}>
  <div class={dotClass}></div>
  <div>
    <strong>{title}</strong>
    {#if !compact}
      <p class="m-0">{detail}</p>
    {/if}
  </div>
</div>
