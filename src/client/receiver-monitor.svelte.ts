import { readPathDiagnostics } from "./receiver-diagnostics";

export function createReceiverMonitor(onRelayDetected: () => void) {
  let incomingSummary = $state("Waiting");
  let pathSummary = $state("Local direct only");
  let incomingFormat = $state("Waiting");
  let videoElementState = $state("Waiting");
  let frameSample = $state("Waiting");
  let inboundStats = $state("Waiting");
  let selectedPath = $state("Waiting");
  let localCandidate = $state("Waiting");
  let remoteCandidate = $state("Waiting");
  let relayState = $state("Blocked by configuration");

  function setIncoming(format: string, summary: string): void {
    incomingFormat = format;
    incomingSummary = summary;
  }

  async function poll(peer: RTCPeerConnection, video: HTMLVideoElement | null): Promise<void> {
    const diagnostics = await readPathDiagnostics(peer, video);
    if (diagnostics.inboundStats) {
      inboundStats = diagnostics.inboundStats;
    }
    if (diagnostics.selectedPath) {
      selectedPath = diagnostics.selectedPath;
    }
    if (diagnostics.pathSummary) {
      pathSummary = diagnostics.pathSummary;
    }
    if (diagnostics.localCandidate) {
      localCandidate = diagnostics.localCandidate;
    }
    if (diagnostics.remoteCandidate) {
      remoteCandidate = diagnostics.remoteCandidate;
    }
    if (diagnostics.relayState) {
      relayState = diagnostics.relayState;
    }
    if (diagnostics.relayDetected) {
      onRelayDetected();
    }
  }

  return {
    get incomingSummary() {
      return incomingSummary;
    },
    get pathSummary() {
      return pathSummary;
    },
    get incomingFormat() {
      return incomingFormat;
    },
    get videoElementState() {
      return videoElementState;
    },
    get frameSample() {
      return frameSample;
    },
    get inboundStats() {
      return inboundStats;
    },
    get selectedPath() {
      return selectedPath;
    },
    get localCandidate() {
      return localCandidate;
    },
    get remoteCandidate() {
      return remoteCandidate;
    },
    get relayState() {
      return relayState;
    },
    setIncoming,
    set videoElementState(state: string) {
      videoElementState = state;
    },
    set frameSample(sample: string) {
      frameSample = sample;
    },
    poll,
  };
}
