import type {
  CameraQuality,
  CameraSettingsMessage,
  PhysicalOrientation,
  VideoRotation,
} from "./types";
import { errorMessage, round } from "./utils";
import {
  getCameraConstraints,
  getQualityLabel,
  getQualityShortLabel,
  getVideoSettings as readVideoSettings,
  tuneVideoSender as applyVideoSenderTuning,
} from "./camera";

type LocalCameraCallbacks = {
  onMeta: (settings: CameraSettingsMessage) => void;
  onRotation: (rotation: VideoRotation) => void;
  onReady: () => void;
  onLog: (message: string) => void;
};

export function createLocalCamera(callbacks: LocalCameraCallbacks) {
  let video: HTMLVideoElement | null = null;
  let stream = $state<MediaStream | null>(null);
  let facingMode: "environment" | "user" = "environment";
  let quality = $state<CameraQuality>("4k");
  let physicalOrientation: PhysicalOrientation = "unknown";
  let rotation: VideoRotation = 0;
  let summary = $state("Waiting");
  let format = $state("Waiting");
  let senderFormat = $state("Balanced adaptive");
  let trackState = $state("No track");

  async function start(): Promise<MediaStream> {
    if (stream) {
      return stream;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support camera capture.");
    }

    const nextStream = await navigator.mediaDevices.getUserMedia(
      getCameraConstraints(facingMode, quality),
    );
    stream = nextStream;
    attachPreview();
    publishSettings("Browser returned");
    callbacks.onReady();
    callbacks.onLog("Camera permission granted.");
    return nextStream;
  }

  async function refreshForOrientation(sender: RTCRtpSender | null | undefined): Promise<void> {
    if (!stream) {
      return;
    }
    stop();
    const nextStream = await start();
    await replaceSenderTrack(sender, nextStream);
    callbacks.onLog("Camera refreshed after orientation change.");
  }

  async function switchCamera(sender: RTCRtpSender | null | undefined): Promise<void> {
    facingMode = facingMode === "environment" ? "user" : "environment";
    stop();
    const nextStream = await start();
    await replaceSenderTrack(sender, nextStream);
  }

  async function toggleQuality(sender: RTCRtpSender | null | undefined): Promise<void> {
    quality = quality === "4k" ? "fullhd" : "4k";
    stop();
    const nextStream = await start();
    await replaceSenderTrack(sender, nextStream);
  }

  async function tuneSender(sender: RTCRtpSender, track: MediaStreamTrack): Promise<void> {
    try {
      const result = await applyVideoSenderTuning(sender, track);
      senderFormat = result.label;
      callbacks.onLog("Video sender tuned for balanced adaptation.");
    } catch (error) {
      senderFormat = "Browser ignored sender tuning";
      callbacks.onLog(`Sender tuning skipped: ${errorMessage(error)}`);
    }
  }

  function publishSettings(prefix: string): void {
    const settings = readSettings();
    renderSettings(settings, prefix);
    if (settings) {
      callbacks.onMeta(settings);
    }
    publishRotation(settings, true);
  }

  function renderSettings(
    settings: CameraSettingsMessage | null | undefined,
    prefix: string,
  ): void {
    if (!settings) {
      format = "Waiting";
      return;
    }
    const fps = settings.frameRate ? `${round(settings.frameRate)} fps` : "fps unknown";
    const size =
      settings.width && settings.height ? `${settings.width} x ${settings.height}` : "size unknown";
    format = `${prefix}: ${size} at ${fps}`;
    summary = `${size} @ ${fps}`;
  }

  function readSettings(): CameraSettingsMessage | null {
    const snapshot = readVideoSettings(stream);
    trackState = snapshot.trackState;
    return snapshot.settings;
  }

  function setVideo(node: HTMLVideoElement): void {
    video = node;
    attachPreview();
  }

  function setPhysicalOrientation(next: PhysicalOrientation): void {
    physicalOrientation = next;
    publishRotation(readSettings());
  }

  function stop(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) {
      video.srcObject = null;
    }
  }

  function attachPreview(): void {
    if (video && stream) {
      video.srcObject = stream;
    }
  }

  async function replaceSenderTrack(
    sender: RTCRtpSender | null | undefined,
    nextStream: MediaStream,
  ): Promise<void> {
    const [track] = nextStream.getVideoTracks();
    if (sender && track) {
      await sender.replaceTrack(track);
      await tuneSender(sender, track);
    }
  }

  function publishRotation(settings: CameraSettingsMessage | null, force = false): void {
    const next = getDisplayRotation(physicalOrientation, settings);
    if (!force && next === rotation) {
      return;
    }
    rotation = next;
    callbacks.onRotation(next);
    callbacks.onLog(`Video display rotation: ${next}deg.`);
  }

  return {
    get hasStream() {
      return Boolean(stream);
    },
    get summary() {
      return summary;
    },
    get format() {
      return format;
    },
    get senderFormat() {
      return senderFormat;
    },
    get requestedFormat() {
      return getQualityLabel(quality);
    },
    get qualityLabel() {
      return getQualityShortLabel(quality);
    },
    get rotation() {
      return rotation;
    },
    get trackState() {
      return trackState;
    },
    start,
    refreshForOrientation,
    switchCamera,
    toggleQuality,
    tuneSender,
    publishSettings,
    renderSettings,
    setVideo,
    setPhysicalOrientation,
    stop,
  };
}

function getDisplayRotation(
  physicalOrientation: PhysicalOrientation,
  settings: CameraSettingsMessage | null,
): VideoRotation {
  if (!settings?.width || !settings.height || settings.width >= settings.height) {
    return 0;
  }

  if (physicalOrientation === "landscape-left") {
    return 90;
  }

  if (physicalOrientation === "landscape-right") {
    return -90;
  }

  return 0;
}
