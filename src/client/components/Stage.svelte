<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import type { Mode } from "../types";

  type Props = {
    mode?: Mode;
    debug?: boolean;
    pairing?: boolean;
    setRemoteVideo?: (node: HTMLVideoElement) => void;
    setLocalVideo?: (node: HTMLVideoElement) => void;
  };

  let {
    mode = "receiver",
    debug = false,
    pairing = false,
    setRemoteVideo = () => {},
    setLocalVideo = () => {},
  }: Props = $props();

  let remoteNode = $state<HTMLVideoElement | null>(null);
  let localNode = $state<HTMLVideoElement | null>(null);

  onMount(() => {
    if (remoteNode) {
      setRemoteVideo(remoteNode);
    }
    if (localNode) {
      setLocalVideo(localNode);
    }
  });

  let stageClass = $derived(getStageClass(mode, debug, pairing));
  let stageStyle = $derived(
    mode === "camera" || mode === "obs"
      ? ""
      : "background: linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), #020504; background-size: 36px 36px;",
  );
  let remoteFrameClass = $derived(
    mode === "obs"
      ? "h-screen w-screen bg-black shadow-none [aspect-ratio:auto]"
      : debug
        ? "aspect-video h-auto w-[min(100%,1280px)] bg-black shadow-panel"
        : "h-[min(100vh,calc(100vw*9/16))] w-[min(100vw,calc(100vh*16/9))] bg-black shadow-panel",
  );
  let previewFrameClass = $derived(
    debug
      ? "aspect-video w-[min(100%,760px)] bg-black shadow-panel"
      : "aspect-video w-full overflow-hidden rounded-[10px] bg-black shadow-panel",
  );

  function getStageClass(currentMode: Mode, showDebug: boolean, isPairing: boolean): string {
    if (isPairing && !showDebug) {
      return "hidden";
    }
    if (currentMode === "obs") {
      return "relative grid h-screen min-h-screen w-screen place-items-center overflow-hidden bg-black";
    }
    if (currentMode === "camera" && !showDebug) {
      return "relative order-2 grid min-h-0 w-[min(100%,390px)] place-items-center overflow-visible bg-transparent";
    }
    return "relative grid min-h-screen place-items-center overflow-hidden bg-[#020504] max-[900px]:min-h-[46vh]";
  }
</script>

<section class={stageClass} style={stageStyle}>
  {#if mode !== "camera"}
    <div class={remoteFrameClass}>
      <video
        class="block h-full w-full bg-black object-contain"
        bind:this={remoteNode}
        autoplay
        muted
        playsinline
      ></video>
    </div>
  {/if}
  {#if mode === "camera"}
    <div class={previewFrameClass}>
      <video
        class="block h-full w-full bg-black object-contain"
        bind:this={localNode}
        autoplay
        muted
        playsinline
      ></video>
    </div>
  {/if}
</section>
