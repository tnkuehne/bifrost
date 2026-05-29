<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    debug?: boolean;
    cameraQr: string;
    cameraUrl: string;
    obsUrl: string;
    copyLabel: string;
    copyDisabled: boolean;
    onCopyObsUrl: () => void;
  };

  let {
    debug = false,
    cameraQr,
    cameraUrl,
    obsUrl,
    copyLabel,
    copyDisabled,
    onCopyObsUrl,
  }: Props = $props();

  const buttonClass =
    "min-h-10 cursor-pointer rounded-md border border-line bg-panel-2 px-3.5 text-text transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-[0.55]";
  let qrClass = $derived(
    debug
      ? "grid w-full place-items-center rounded-lg border border-line bg-white p-3.5"
      : "mt-[22px] grid w-full place-items-center rounded-[10px] bg-white p-5",
  );
  let qrImageClass = $derived(
    debug ? "block aspect-square w-[min(100%,260px)]" : "block aspect-square w-[min(100%,340px)]",
  );
</script>

<section>
  {#if debug}
    <h2 class="mt-6 text-sm uppercase tracking-normal text-muted">Pair Phone</h2>
  {/if}
  <div class={debug ? "grid gap-3" : "grid gap-2.5"}>
    <div class={qrClass}>
      {#if cameraQr}
        <img class={qrImageClass} src={cameraQr} alt="QR code for phone camera page" />
      {/if}
    </div>
    {#if debug}
      <div
        class="w-full rounded-md border border-line bg-[#080e0b] px-3 py-[11px] text-text [overflow-wrap:anywhere]"
      >
        {cameraUrl}
      </div>
    {/if}
  </div>

  {#if debug}
    <h2 class="mt-6 text-sm uppercase tracking-normal text-muted">OBS</h2>
    <div
      class="w-full rounded-md border border-line bg-[#080e0b] px-3 py-[11px] text-text [overflow-wrap:anywhere]"
    >
      {obsUrl}
    </div>
  {/if}
  <div class="mt-3.5 grid gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        class={debug ? buttonClass : `${buttonClass} w-full`}
        type="button"
        disabled={copyDisabled}
        onclick={onCopyObsUrl}
      >
        {copyLabel}
      </button>
    </div>
  </div>
</section>
