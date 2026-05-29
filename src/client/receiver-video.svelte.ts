import {
  getIncomingFormat,
  getVideoElementState,
  readPathDiagnostics,
} from "./receiver-diagnostics";
import { errorMessage } from "./utils";

type ReceiverVideoCallbacks = {
  onRelayDetected: () => void;
  onLog: (message: string) => void;
};

export function createReceiverVideo(callbacks: ReceiverVideoCallbacks) {
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let incomingFrames = 0;
  let lastIncomingAt = 0;

  let incomingSummary = $state("Waiting");
  let pathSummary = $state("Local direct only");
  let incomingFormat = $state("Waiting");
  let inboundStats = $state("Waiting");
  let selectedPath = $state("Waiting");
  let relayState = $state("Blocked by configuration");

  function setVideo(node: HTMLVideoElement): void {
    video = node;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    if (stream) {
      video.srcObject = stream;
      tryPlay("video element remounted");
    }
  }

  function attachStream(nextStream: MediaStream): boolean {
    stream = nextStream;
    if (!video) {
      return false;
    }
    video.srcObject = nextStream;
    return true;
  }

  function clear(): void {
    stream = null;
    if (video) {
      video.srcObject = null;
    }
    incomingFrames = 0;
    lastIncomingAt = 0;
  }

  function trackIncomingVideo(): void {
    if (!video) {
      return;
    }
    for (const eventName of [
      "loadedmetadata",
      "playing",
      "waiting",
      "stalled",
      "pause",
      "resize",
      "error",
    ]) {
      video.addEventListener(eventName, () => {
        callbacks.onLog(`Video event: ${eventName}`);
        updateElementState();
      });
    }

    if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
      video.addEventListener("resize", () => updateIncomingFormat());
      return;
    }

    const onFrame: VideoFrameRequestCallback = (now) => {
      incomingFrames += 1;
      if (!lastIncomingAt) {
        lastIncomingAt = now;
      }
      if (now - lastIncomingAt > 1000) {
        const fps = (incomingFrames * 1000) / (now - lastIncomingAt);
        incomingFrames = 0;
        lastIncomingAt = now;
        updateIncomingFormat(fps);
        updateElementState();
      }
      video?.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  function updateIncomingFormat(fps?: number): void {
    const next = getIncomingFormat(video, fps);
    incomingFormat = next.format;
    incomingSummary = next.summary;
  }

  function tryPlay(reason: string): void {
    if (!video?.srcObject) {
      return;
    }
    video
      .play()
      .then(() => {
        callbacks.onLog(`Video playback started (${reason}).`);
        updateElementState();
      })
      .catch((error: unknown) => {
        callbacks.onLog(`Video play blocked (${reason}): ${errorMessage(error)}`);
      });
  }

  async function pollPath(peer: RTCPeerConnection): Promise<void> {
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
    if (diagnostics.relayState) {
      relayState = diagnostics.relayState;
    }
    callbacks.onLog(
      `Path details: local=${diagnostics.localCandidate || "unknown"}, remote=${diagnostics.remoteCandidate || "unknown"}, video=${diagnostics.videoStats || "unknown"}`,
    );
    if (diagnostics.relayDetected) {
      callbacks.onRelayDetected();
    }
  }

  function updateElementState(): void {
    callbacks.onLog(`Video element: ${getVideoElementState(video)}`);
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
    get inboundStats() {
      return inboundStats;
    },
    get selectedPath() {
      return selectedPath;
    },
    get relayState() {
      return relayState;
    },
    setVideo,
    attachStream,
    clear,
    trackIncomingVideo,
    tryPlay,
    pollPath,
  };
}
