<svelte:options runes={true} />

<script lang="ts">
  import type { Mode } from "../types";
  import VideoFrame from "./VideoFrame.svelte";

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
</script>

{#if pairing && !debug}
  <section class="hidden"></section>
{:else if mode === "obs"}
  <section
    class="relative grid h-screen min-h-screen w-screen place-items-center overflow-hidden bg-black"
  >
    <VideoFrame
      frameClass="h-screen w-screen bg-black shadow-none [aspect-ratio:auto]"
      setVideo={setRemoteVideo}
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
  </section>
{:else if mode === "camera"}
  <section
    class="relative grid min-h-screen place-items-center overflow-hidden bg-[#020504] max-[900px]:min-h-[46vh]"
    style="background: linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), #020504; background-size: 36px 36px;"
  >
    <VideoFrame
      frameClass="aspect-video w-[min(100%,760px)] bg-black shadow-panel"
      setVideo={setLocalVideo}
    />
  </section>
{:else}
  <section
    class="relative grid min-h-screen place-items-center overflow-hidden bg-[#020504] max-[900px]:min-h-[46vh]"
    style="background: linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), #020504; background-size: 36px 36px;"
  >
    <VideoFrame
      frameClass={debug
        ? "aspect-video h-auto w-[min(100%,1280px)] bg-black shadow-panel"
        : "h-[min(100vh,calc(100vw*9/16))] w-[min(100vw,calc(100vh*16/9))] bg-black shadow-panel"}
      setVideo={setRemoteVideo}
    />
  </section>
{/if}
