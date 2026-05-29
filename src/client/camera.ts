import type { CameraSettingsMessage } from "./types";

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: 30 },
  },
};

export type CameraSettingsSnapshot = {
  settings: CameraSettingsMessage | null;
  trackState: string;
};

export type SenderTuningResult = {
  label: string;
  maxBitrate: number;
};

export function getCameraConstraints(facingMode: "environment" | "user"): MediaStreamConstraints {
  return {
    ...CAMERA_CONSTRAINTS,
    video: {
      ...(CAMERA_CONSTRAINTS.video as MediaTrackConstraints),
      facingMode: { ideal: facingMode },
    },
  };
}

export function getVideoSettings(stream: MediaStream | null): CameraSettingsSnapshot {
  const [track] = stream?.getVideoTracks() || [];
  if (!track) {
    return { settings: null, trackState: "No track" };
  }

  const settings = track.getSettings();
  return {
    settings: {
      width: settings.width || null,
      height: settings.height || null,
      frameRate: settings.frameRate || null,
      facingMode: settings.facingMode || null,
    },
    trackState: `${track.readyState}, ${settings.facingMode || "unknown"} camera`,
  };
}

export async function tuneVideoSender(
  sender: RTCRtpSender,
  track: MediaStreamTrack,
): Promise<SenderTuningResult> {
  const settings = track.getSettings();
  const width = settings.width || 3840;
  const height = settings.height || 2160;
  const frameRate = settings.frameRate || 30;
  const maxBitrate = Math.min(
    50_000_000,
    Math.max(12_000_000, Math.round(width * height * frameRate * 0.09)),
  );
  const parameters = sender.getParameters();
  parameters.degradationPreference = "balanced";
  parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
  parameters.encodings[0] = {
    ...parameters.encodings[0],
    maxBitrate,
    maxFramerate: frameRate,
  };

  await sender.setParameters(parameters);
  return {
    label: `balanced adaptive, ${Math.round(maxBitrate / 1_000_000)} Mbps cap`,
    maxBitrate,
  };
}
