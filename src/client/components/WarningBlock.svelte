<svelte:options runes={true} />

<script lang="ts">
  import triangleAlertUrl from "../assets/triangle-alert.svg";

  type Props = {
    message: string;
  };

  let { message }: Props = $props();
</script>

<div
  class="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2.5 rounded-lg border border-warn/40 bg-warn/8 p-3 text-sm"
>
  <span
    class="mt-0.5 size-5 bg-warn"
    style={`mask: url("${triangleAlertUrl}") center / contain no-repeat;`}
    aria-hidden="true"
  ></span>
  <p class="m-0 text-text">{message}</p>
</div>
