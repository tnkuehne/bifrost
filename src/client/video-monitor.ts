import { els, remoteVideo } from "./dom";
import type {
  AppState,
  CandidatePairReport,
  CandidateReport,
  InboundVideoReport,
  StatsReport,
  TransportReport,
} from "./types";
import { errorMessage, round } from "./utils";

interface VideoMonitorCallbacks {
  fail(message: string): void;
  log(message: string): void;
  closePeerConnection(): void;
}

export function createVideoMonitor(state: AppState, callbacks: VideoMonitorCallbacks) {
  const { fail, log, closePeerConnection } = callbacks;

  function trackIncomingVideo(): void {
    for (const eventName of [
      "loadedmetadata",
      "playing",
      "waiting",
      "stalled",
      "pause",
      "resize",
      "error",
    ]) {
      remoteVideo.addEventListener(eventName, () => {
        log(`Video event: ${eventName}`);
        updateVideoElementState();
      });
    }

    if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
      remoteVideo.addEventListener("resize", () => updateIncomingFormat());
      return;
    }

    const onFrame: VideoFrameRequestCallback = (now) => {
      state.incomingFrames += 1;
      if (!state.lastIncomingAt) {
        state.lastIncomingAt = now;
      }
      if (now - state.lastIncomingAt > 1000) {
        const fps = (state.incomingFrames * 1000) / (now - state.lastIncomingAt);
        state.incomingFrames = 0;
        state.lastIncomingAt = now;
        updateIncomingFormat(fps);
        updateVideoElementState();
        sampleRemoteFrame(now);
      }
      remoteVideo.requestVideoFrameCallback(onFrame);
    };
    remoteVideo.requestVideoFrameCallback(onFrame);
  }

  function updateIncomingFormat(fps?: number): void {
    const size =
      remoteVideo.videoWidth && remoteVideo.videoHeight
        ? `${remoteVideo.videoWidth} x ${remoteVideo.videoHeight}`
        : "size unknown";
    els.incomingFormat.textContent = fps ? `${size} at ${round(fps)} fps measured` : size;
    els.incomingSummary.textContent = fps ? `${size} @ ${round(fps)} fps` : size;
  }

  function tryPlayRemoteVideo(reason: string): void {
    if (!remoteVideo.srcObject) {
      return;
    }
    remoteVideo
      .play()
      .then(() => {
        log(`Video playback started (${reason}).`);
        updateVideoElementState();
      })
      .catch((error: unknown) => {
        log(`Video play blocked (${reason}): ${errorMessage(error)}`);
        els.videoElementState.textContent = "play blocked; click receiver page once";
      });
  }

  function updateVideoElementState(): void {
    const states = ["empty", "metadata", "current data", "future data", "enough data"];
    const ready = states[remoteVideo.readyState] || String(remoteVideo.readyState);
    const size =
      remoteVideo.clientWidth && remoteVideo.clientHeight
        ? `${remoteVideo.clientWidth} x ${remoteVideo.clientHeight} CSS`
        : "no layout box";
    els.videoElementState.textContent = `${ready}, ${
      remoteVideo.paused ? "paused" : "playing"
    }, ${size}`;
  }

  function sampleRemoteFrame(now = performance.now()): void {
    if (
      now - state.lastFrameSampleAt < 1000 ||
      !remoteVideo.videoWidth ||
      !remoteVideo.videoHeight
    ) {
      return;
    }
    state.lastFrameSampleAt = now;

    const canvas = document.createElement("canvas");
    const width = 32;
    const height = 32;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      els.frameSample.textContent = "Canvas unavailable";
      return;
    }

    try {
      context.drawImage(remoteVideo, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let lumaTotal = 0;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        redTotal += red;
        greenTotal += green;
        blueTotal += blue;
        lumaTotal += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
      const count = pixels.length / 4;
      const luma = lumaTotal / count;
      const red = redTotal / count;
      const green = greenTotal / count;
      const blue = blueTotal / count;
      const verdict = luma < 3 ? "black pixels" : "non-black pixels";
      els.frameSample.textContent = `${verdict}, luma ${round(luma)}, rgb ${round(red)}/${round(
        green,
      )}/${round(blue)}`;
    } catch (error) {
      els.frameSample.textContent = `Canvas sample failed: ${errorMessage(error)}`;
    }
  }

  function startStatsPolling(): void {
    if (state.statsTimer) {
      return;
    }
    state.statsTimer = window.setInterval(pollSelectedPath, 1200);
    pollSelectedPath();
  }

  async function pollSelectedPath(): Promise<void> {
    if (!state.pc) {
      return;
    }
    const stats = await state.pc.getStats();
    const reports = new Map<string, StatsReport>();
    const reportList: StatsReport[] = [];
    stats.forEach((report) => {
      const typedReport = report as StatsReport;
      reports.set(report.id, typedReport);
      reportList.push(typedReport);
    });

    let selectedPair: (StatsReport & CandidatePairReport) | null = null;
    let inboundVideo: (StatsReport & InboundVideoReport) | null = null;
    for (const typedReport of reportList) {
      const report = typedReport;
      if (report.type === "transport") {
        const transportReport = typedReport as StatsReport & TransportReport;
        if (transportReport.selectedCandidatePairId) {
          selectedPair =
            (reports.get(transportReport.selectedCandidatePairId) as
              | (StatsReport & CandidatePairReport)
              | undefined) ?? null;
        }
      }
      if (report.type === "candidate-pair") {
        const pairReport = typedReport as StatsReport & CandidatePairReport;
        if (pairReport.selected) {
          selectedPair = pairReport;
        }
      }
      if (report.type === "inbound-rtp" && report["kind"] === "video") {
        inboundVideo = typedReport as StatsReport & InboundVideoReport;
      }
    }

    if (inboundVideo) {
      const width = inboundVideo.frameWidth || remoteVideo.videoWidth || "?";
      const height = inboundVideo.frameHeight || remoteVideo.videoHeight || "?";
      const fps = inboundVideo.framesPerSecond
        ? `${round(inboundVideo.framesPerSecond)} fps`
        : "fps hidden";
      const decoded = inboundVideo.framesDecoded ?? "?";
      const dropped = inboundVideo.framesDropped ?? "?";
      const freezes = inboundVideo.freezeCount ?? 0;
      els.inboundStats.textContent = `${width} x ${height}, ${fps}, decoded ${decoded}, dropped ${dropped}, freezes ${freezes}`;
    }

    if (!selectedPair) {
      return;
    }

    const local = selectedPair.localCandidateId
      ? (reports.get(selectedPair.localCandidateId) as (StatsReport & CandidateReport) | undefined)
      : undefined;
    const remote = selectedPair.remoteCandidateId
      ? (reports.get(selectedPair.remoteCandidateId) as (StatsReport & CandidateReport) | undefined)
      : undefined;
    const localText = describeCandidate(local);
    const remoteText = describeCandidate(remote);
    const relay = [local, remote].some((candidate) => candidate?.candidateType === "relay");
    const direct =
      !relay &&
      [local, remote].every((candidate) => !candidate || candidate.candidateType !== "srflx");

    els.selectedPath.textContent = direct
      ? "Direct non-relay ICE candidate pair selected"
      : "Selected path needs review";
    els.pathSummary.textContent = direct ? "Local direct" : "Needs review";
    els.localCandidate.textContent = localText;
    els.remoteCandidate.textContent = remoteText;
    els.relayState.textContent = relay
      ? "Relay detected - connection closed"
      : "No relay candidate selected";

    if (relay) {
      fail("A relay candidate was selected. Closing instead of carrying media through a relay.");
      closePeerConnection();
    }
  }

  return {
    startStatsPolling,
    trackIncomingVideo,
    tryPlayRemoteVideo,
    updateVideoElementState,
  };
}

function describeCandidate(candidate: CandidateReport | undefined): string {
  if (!candidate) {
    return "Hidden by browser until connected";
  }
  const address = candidate.address || candidate.ip || candidate.url || "address hidden";
  const protocol = candidate.protocol || "protocol hidden";
  const port = candidate.port ? `:${candidate.port}` : "";
  return `${candidate.candidateType || "unknown"} ${protocol} ${address}${port}`;
}
