<svelte:options runes={true} />

<script lang="ts">
  import type { Mode, VideoRotation } from "../types";
  import switchCameraUrl from "../assets/switch-camera.svg";
  import VideoFrame from "./VideoFrame.svelte";

  type Props = {
    mode?: Mode;
    debug?: boolean;
    pairing?: boolean;
    hasLocalStream?: boolean;
    remoteVideoRotation?: VideoRotation;
    setRemoteVideo?: (node: HTMLVideoElement) => void;
    setLocalVideo?: (node: HTMLVideoElement) => void;
    onSwitchCamera?: () => void;
    onToggleQuality?: () => void;
    qualityLabel?: string;
  };

  let {
    mode = "receiver",
    debug = false,
    pairing = false,
    hasLocalStream = false,
    remoteVideoRotation = 0,
    setRemoteVideo = () => {},
    setLocalVideo = () => {},
    onSwitchCamera = () => {},
    onToggleQuality = () => {},
    qualityLabel = "4K",
  }: Props = $props();
</script>

{#if pairing && !debug}
  <section class="hidden">
    <VideoFrame
      frameClass="h-[min(100vh,calc(100vw*9/16))] w-[min(100vw,calc(100vh*16/9))] bg-black shadow-panel"
      setVideo={setRemoteVideo}
      rotation={remoteVideoRotation}
    />
  </section>
{:else if mode === "obs"}
  <section
    class="relative grid h-screen min-h-screen w-screen place-items-center overflow-hidden bg-black"
  >
    <VideoFrame
      frameClass="h-screen w-screen bg-black shadow-none [aspect-ratio:auto]"
      setVideo={setRemoteVideo}
      rotation={remoteVideoRotation}
    />
  </section>
{:else if mode === "camera" && !debug}
  <section
    class="relative order-2 grid min-h-0 w-[min(100%,390px)] place-items-center overflow-visible bg-transparent"
  >
    <VideoFrame
      frameClass="aspect-video w-full overflow-hidden rounded-[10px] bg-black shadow-panel"
      setVideo={setLocalVideo}
    />
    {#if hasLocalStream}
      <button
        class="absolute right-3 bottom-3 grid size-11 cursor-pointer place-items-center rounded-full bg-black/35 text-white shadow-panel backdrop-blur-md transition hover:bg-black/50 active:scale-95"
        type="button"
        aria-label="Switch camera"
        title="Switch camera"
        onclick={onSwitchCamera}
      >
        <img class="size-5 invert" src={switchCameraUrl} alt="" aria-hidden="true" />
      </button>
      <button
        class="absolute bottom-3 left-3 grid h-11 min-w-11 cursor-pointer place-items-center rounded-full bg-black/35 px-3 text-sm font-semibold text-white shadow-panel backdrop-blur-md transition hover:bg-black/50 active:scale-95"
        type="button"
        aria-label="Switch video quality"
        title="Switch video quality"
        onclick={onToggleQuality}
      >
        {qualityLabel}
      </button>
    {/if}
  </section>
{:else if mode === "camera"}
  <section
    class="grid-backdrop relative grid min-h-screen place-items-center overflow-hidden max-[900px]:min-h-[46vh]"
  >
    <VideoFrame
      frameClass="aspect-video w-[min(100%,760px)] bg-black shadow-panel"
      setVideo={setLocalVideo}
    />
    {#if hasLocalStream}
      <button
        class="absolute right-5 bottom-5 grid size-12 cursor-pointer place-items-center rounded-full bg-black/35 text-white shadow-panel backdrop-blur-md transition hover:bg-black/50 active:scale-95"
        type="button"
        aria-label="Switch camera"
        title="Switch camera"
        onclick={onSwitchCamera}
      >
        <img class="size-5 invert" src={switchCameraUrl} alt="" aria-hidden="true" />
      </button>
      <button
        class="absolute bottom-5 left-5 grid h-12 min-w-12 cursor-pointer place-items-center rounded-full bg-black/35 px-3 text-sm font-semibold text-white shadow-panel backdrop-blur-md transition hover:bg-black/50 active:scale-95"
        type="button"
        aria-label="Switch video quality"
        title="Switch video quality"
        onclick={onToggleQuality}
      >
        {qualityLabel}
      </button>
    {/if}
  </section>
{:else}
  <section
    class="grid-backdrop relative grid min-h-screen place-items-center overflow-hidden max-[900px]:min-h-[46vh]"
  >
    <VideoFrame
      frameClass={debug
        ? "aspect-video h-auto w-[min(100%,1280px)] bg-black shadow-panel"
        : "h-[min(100vh,calc(100vw*9/16))] w-[min(100vw,calc(100vh*16/9))] bg-black shadow-panel"}
      setVideo={setRemoteVideo}
      rotation={remoteVideoRotation}
    />
  </section>
{/if}
