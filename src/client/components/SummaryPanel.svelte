<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    cameraSummary: string;
    incomingSummary: string;
    pathSummary: string;
  };

  let { cameraSummary, incomingSummary, pathSummary }: Props = $props();
</script>

<section>
  <h2 class="mt-6 text-sm uppercase tracking-normal text-muted">Stream</h2>
  <div class="grid gap-2 rounded-lg border border-line bg-white/[0.03] p-3">
    <div class="flex justify-between gap-2 text-sm text-muted">
      <span>Camera</span><strong class="text-right text-text">{cameraSummary}</strong>
    </div>
    <div class="flex justify-between gap-2 text-sm text-muted">
      <span>Receiver</span><strong class="text-right text-text">{incomingSummary}</strong>
    </div>
    <div class="flex justify-between gap-2 text-sm text-muted">
      <span>Path</span><strong class="text-right text-text">{pathSummary}</strong>
    </div>
  </div>
</section>
