<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    title: string;
    compact: boolean;
  };

  let { title, compact }: Props = $props();
</script>

<div
  class={compact
    ? "mb-3 flex flex-wrap items-center justify-between gap-2"
    : "flex flex-wrap items-center justify-between gap-2"}
>
  <h1 class={compact ? "m-0 text-[22px] leading-tight" : "m-0 text-2xl leading-tight"}>
    {title}
  </h1>
</div>
