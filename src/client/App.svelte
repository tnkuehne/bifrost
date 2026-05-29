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
  import { createWebcamSession } from "./session.svelte";

  const session = createWebcamSession();

  onMount(session.mount);
</script>

<svelte:head>
  <title>Local WebRTC Webcam</title>
</svelte:head>

<AppLayout mode={session.mode} debug={session.debug} remoteVideoVisible={session.hasRemoteVideo}>
  {#snippet stage()}
    <Stage
      mode={session.mode}
      debug={session.debug}
      pairing={session.pairing}
      setRemoteVideo={session.setRemoteVideo}
      setLocalVideo={session.setLocalVideo}
    />
  {/snippet}

  {#snippet panel()}
    <div class="grid gap-3">
      <Toolbar
        title={session.title}
        debug={session.debug}
        compact={!session.debug}
        onToggleDebug={session.toggleDebug}
      />
      <StatusBlock
        kind={session.statusKind}
        title={session.statusTitle}
        detail={session.statusDetail}
        compact={!session.debug}
      />
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
        onSwitchCamera={session.switchCameraFromUi}
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
