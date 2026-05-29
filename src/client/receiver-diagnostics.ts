import type {
  CandidatePairReport,
  CandidateReport,
  InboundVideoReport,
  StatsReport,
  TransportReport,
} from "./types";
import { round } from "./utils";

export type IncomingFormat = {
  format: string;
  summary: string;
};

export type PathDiagnostics = {
  inboundStats?: string;
  selectedPath?: string;
  pathSummary?: string;
  localCandidate?: string;
  remoteCandidate?: string;
  videoStats?: string;
  relayState?: string;
  relayDetected: boolean;
};

export function getIncomingFormat(
  remoteVideo: HTMLVideoElement | null,
  fps?: number,
): IncomingFormat {
  const size =
    remoteVideo?.videoWidth && remoteVideo.videoHeight
      ? `${remoteVideo.videoWidth} x ${remoteVideo.videoHeight}`
      : "size unknown";
  return {
    format: fps ? `${size} at ${round(fps)} fps measured` : size,
    summary: fps ? `${size} @ ${round(fps)} fps` : size,
  };
}

export function getVideoElementState(remoteVideo: HTMLVideoElement | null): string {
  if (!remoteVideo) {
    return "Waiting";
  }
  const states = ["empty", "metadata", "current data", "future data", "enough data"];
  const ready = states[remoteVideo.readyState] || String(remoteVideo.readyState);
  const size =
    remoteVideo.clientWidth && remoteVideo.clientHeight
      ? `${remoteVideo.clientWidth} x ${remoteVideo.clientHeight} CSS`
      : "no layout box";
  return `${ready}, ${remoteVideo.paused ? "paused" : "playing"}, ${size}`;
}

export async function readPathDiagnostics(
  peer: RTCPeerConnection,
  remoteVideo: HTMLVideoElement | null,
): Promise<PathDiagnostics> {
  const stats = await peer.getStats();
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

  const result: PathDiagnostics = { relayDetected: false };
  if (inboundVideo) {
    const width = inboundVideo.frameWidth || remoteVideo?.videoWidth || "?";
    const height = inboundVideo.frameHeight || remoteVideo?.videoHeight || "?";
    const fps = inboundVideo.framesPerSecond
      ? `${round(inboundVideo.framesPerSecond)} fps`
      : "fps hidden";
    const decoded = inboundVideo.framesDecoded ?? "?";
    const dropped = inboundVideo.framesDropped ?? "?";
    const freezes = inboundVideo.freezeCount ?? 0;
    result.inboundStats = `${width} x ${height}, ${fps}`;
    result.videoStats = `decoded ${decoded}, dropped ${dropped}, freezes ${freezes}`;
  }

  if (!selectedPair) {
    return result;
  }

  const local = selectedPair.localCandidateId
    ? (reports.get(selectedPair.localCandidateId) as (StatsReport & CandidateReport) | undefined)
    : undefined;
  const remote = selectedPair.remoteCandidateId
    ? (reports.get(selectedPair.remoteCandidateId) as (StatsReport & CandidateReport) | undefined)
    : undefined;
  const relayDetected = [local, remote].some((candidate) => candidate?.candidateType === "relay");
  const direct =
    !relayDetected &&
    [local, remote].every((candidate) => !candidate || candidate.candidateType !== "srflx");

  return {
    ...result,
    selectedPath: direct
      ? "Direct non-relay ICE candidate pair selected"
      : "Selected path needs review",
    pathSummary: direct ? "Local direct" : "Needs review",
    localCandidate: describeCandidate(local),
    remoteCandidate: describeCandidate(remote),
    relayState: relayDetected
      ? "Relay detected - connection closed"
      : "No relay candidate selected",
    relayDetected,
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
