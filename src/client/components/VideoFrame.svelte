<svelte:options runes={true} />

<script lang="ts">
  import type { VideoRotation } from "../types";

  type Props = {
    frameClass: string;
    setVideo: (node: HTMLVideoElement) => void;
    rotation?: VideoRotation;
  };

  let { frameClass, setVideo, rotation = 0 }: Props = $props();
  let node = $state<HTMLVideoElement | null>(null);
  let videoStyle = $derived(
    rotation === 0
      ? ""
      : `transform: rotate(${rotation}deg) scale(1.7778); transform-origin: center;`,
  );

  $effect(() => {
    if (node) {
      setVideo(node);
    }
  });
</script>

<div class={frameClass}>
  <video
    class="block h-full w-full bg-black object-contain"
    style={videoStyle}
    bind:this={node}
    autoplay
    muted
    playsinline
  ></video>
</div>
