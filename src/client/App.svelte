<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import AppLayout from "./components/AppLayout.svelte";
  import CameraPanel from "./components/CameraPanel.svelte";
  import DebugPanels from "./components/DebugPanels.svelte";
  import ReceiverPanel from "./components/ReceiverPanel.svelte";
  import Stage from "./components/Stage.svelte";
  import StatusBlock from "./components/StatusBlock.svelte";
  import SummaryPanel from "./components/SummaryPanel.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import githubMarkUrl from "./assets/github-mark.svg";
  import { createWebcamSession } from "./session.svelte";

  const sourceUrl = "https://github.com/tnkuehne/bifrost";
  const session = createWebcamSession();

  onMount(session.mount);
</script>

<svelte:head>
  <title>Bifrost</title>
</svelte:head>

<AppLayout mode={session.mode} debug={session.debug} remoteVideoVisible={session.hasRemoteVideo}>
  {#snippet stage()}
    <Stage
      mode={session.mode}
      debug={session.debug}
      pairing={session.pairing}
      hasLocalStream={session.hasStream}
      setRemoteVideo={session.setRemoteVideo}
      setLocalVideo={session.setLocalVideo}
      onSwitchCamera={session.switchCameraFromUi}
      onToggleQuality={session.toggleQualityFromUi}
      qualityLabel={session.qualityLabel}
    />
  {/snippet}

  {#snippet panel()}
    <div class="grid gap-3">
      {#if session.mode === "receiver"}
        <StatusBlock
          kind={session.statusKind}
          title={session.statusTitle}
          detail={session.statusDetail}
          compact={!session.debug}
        />
      {:else if session.mode === "camera"}
        <StatusBlock
          kind={session.statusKind}
          title={session.statusTitle}
          detail={session.statusDetail}
          compact={!session.debug}
        />
      {:else}
        <div class="flex items-center justify-between gap-2">
          <Toolbar title={session.title} compact={!session.debug} />
          <button
            class="min-h-10 cursor-pointer rounded-md border border-line bg-panel-2 px-3.5 text-text disabled:cursor-not-allowed disabled:opacity-[0.55]"
            type="button"
            onclick={session.toggleDebug}
          >
            {session.debug ? "Normal" : "Debug"}
          </button>
        </div>
        <StatusBlock
          kind={session.statusKind}
          title={session.statusTitle}
          detail={session.statusDetail}
          compact={!session.debug}
        />
      {/if}
    </div>

    {#if session.mode !== "camera"}
      <ReceiverPanel
        debug={session.debug}
        cameraQr={session.cameraQr}
        cameraUrl={session.cameraUrl}
        obsUrl={session.obsUrl}
        copyLabel={session.copyLabel}
        copyDisabled={session.copyDisabled}
        onCopyObsUrl={session.copyObsUrl}
      />
    {/if}

    {#if session.mode === "camera"}
      <CameraPanel
        compact={!session.debug}
        hasStream={session.hasStream}
        onStartCamera={session.startCameraFromUi}
      />
    {/if}

    {#if session.mode !== "camera" && session.debug}
      <SummaryPanel
        cameraSummary={session.cameraSummary}
        incomingSummary={session.incomingSummary}
        pathSummary={session.pathSummary}
      />
    {/if}

    {#if session.showDebug}
      <DebugPanels
        mode={session.mode}
        role={session.role}
        iceServersCount={session.iceServersCount}
        requestedFormat={session.requestedFormat}
        cameraFormat={session.cameraFormat}
        senderFormat={session.senderFormat}
        trackState={session.trackState}
        incomingFormat={session.incomingFormat}
        inboundStats={session.inboundStats}
        selectedPath={session.selectedPath}
        relayState={session.relayState}
      />
    {/if}
  {/snippet}
</AppLayout>

{#if session.mode === "receiver"}
  <a
    class="fixed top-4 right-4 z-20 block opacity-80 transition hover:opacity-100 active:scale-[0.96]"
    href={sourceUrl}
    target="_blank"
    rel="noreferrer"
    aria-label="Open source on GitHub"
    title="Open source on GitHub"
  >
    <img class="size-6 invert" src={githubMarkUrl} alt="" aria-hidden="true" />
  </a>
  <button
    class="fixed right-4 bottom-4 z-20 min-h-10 cursor-pointer rounded-md border border-line bg-panel-2 px-3.5 text-text shadow-panel disabled:cursor-not-allowed disabled:opacity-[0.55]"
    type="button"
    onclick={session.toggleDebug}
  >
    {session.debug ? "Normal" : "Debug"}
  </button>
{/if}
