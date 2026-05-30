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
  let videoTransform = $derived(
    rotation === 0 ? undefined : `rotate(${rotation}deg) scale(1.7778)`,
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
    style:transform={videoTransform}
    style:transform-origin={videoTransform ? "center" : undefined}
    bind:this={node}
    autoplay
    muted
    playsinline
  ></video>
</div>
