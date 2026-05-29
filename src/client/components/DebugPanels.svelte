<svelte:options runes={true} />

<script lang="ts">
  import type { Mode, Role } from "../types";

  type Props = {
    mode: Mode;
    role: Role;
    iceServersCount: number;
    cameraFormat: string;
    senderFormat: string;
    trackState: string;
    incomingFormat: string;
    inboundStats: string;
    selectedPath: string;
    relayState: string;
  };

  let {
    mode,
    role,
    iceServersCount,
    cameraFormat,
    senderFormat,
    trackState,
    incomingFormat,
    inboundStats,
    selectedPath,
    relayState,
  }: Props = $props();

  const headingClass = "mt-6 text-sm uppercase tracking-normal text-muted";
  const rowClass =
    "grid grid-cols-[120px_minmax(0,1fr)] gap-2 border-b border-white/8 py-2 text-sm";
  const labelClass = "text-muted";
</script>

<section>
  <h2 class={headingClass}>Camera Format</h2>
  <div class={rowClass}>
    <span class={labelClass}>Page role</span><strong>{mode} ({role})</strong>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Requested</span><span>4K ideal, 30 fps</span>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Returned</span><strong>{cameraFormat}</strong>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Sender</span><span>{senderFormat}</span>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Track</span><span>{trackState}</span>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Incoming</span><span>{incomingFormat}</span>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Inbound RTP</span><span>{inboundStats}</span>
  </div>
</section>

<section>
  <h2 class={headingClass}>Direct Path Check</h2>
  <div class={rowClass}>
    <span class={labelClass}>ICE servers</span><span>{iceServersCount} configured</span>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Selected path</span><span>{selectedPath}</span>
  </div>
  <div class={rowClass}>
    <span class={labelClass}>Relay use</span><strong>{relayState}</strong>
  </div>
</section>
