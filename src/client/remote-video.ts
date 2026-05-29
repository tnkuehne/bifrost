import { getIncomingFormat, getVideoElementState, sampleVideoFrame } from "./receiver-diagnostics";
import { errorMessage } from "./utils";

type RemoteVideoMonitorCallbacks = {
  onIncomingFormat: (format: string, summary: string) => void;
  onElementState: (state: string) => void;
  onFrameSample: (sample: string) => void;
  onLog: (message: string) => void;
};

export function createRemoteVideoMonitor(callbacks: RemoteVideoMonitorCallbacks) {
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let incomingFrames = 0;
  let lastIncomingAt = 0;
  let lastFrameSampleAt = 0;

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
    lastFrameSampleAt = 0;
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
        sampleRemoteFrame(now);
      }
      video?.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  function updateIncomingFormat(fps?: number): void {
    const next = getIncomingFormat(video, fps);
    callbacks.onIncomingFormat(next.format, next.summary);
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
        callbacks.onElementState("play blocked; click receiver page once");
      });
  }

  function updateElementState(): void {
    callbacks.onElementState(getVideoElementState(video));
  }

  function sampleRemoteFrame(now = performance.now()): void {
    if (now - lastFrameSampleAt < 1000 || !video?.videoWidth || !video.videoHeight) {
      return;
    }
    lastFrameSampleAt = now;
    callbacks.onFrameSample(sampleVideoFrame(video));
  }

  return {
    get video() {
      return video;
    },
    setVideo,
    attachStream,
    clear,
    trackIncomingVideo,
    tryPlay,
    updateElementState,
  };
}
