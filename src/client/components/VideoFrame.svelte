<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    frameClass: string;
    setVideo: (node: HTMLVideoElement) => void;
  };

  let { frameClass, setVideo }: Props = $props();
  let node = $state<HTMLVideoElement | null>(null);

  $effect(() => {
    if (node) {
      setVideo(node);
    }
  });
</script>

<div class={frameClass}>
  <video
    class="block h-full w-full bg-black object-contain"
    bind:this={node}
    autoplay
    muted
    playsinline
  ></video>
</div>
