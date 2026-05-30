export type Mode = "receiver" | "camera" | "obs";
export type Role = "receiver" | "camera";
export type StatusKind = "waiting" | "good" | "bad";
export type CameraQuality = "4k" | "fullhd";
export type PhysicalOrientation = "portrait" | "landscape-left" | "landscape-right" | "unknown";
export type VideoRotation = -90 | 0 | 90;

export interface RoomResponse {
  room: string;
  receiverUrl?: string;
  cameraUrl?: string;
  obsUrl?: string;
}

export interface CameraSettingsMessage {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  facingMode: string | null;
}

export interface SignalMessage {
  type: string;
  role?: Role;
  clientMode?: string;
  peers?: Role[];
  receiverActive?: boolean;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  settings?: CameraSettingsMessage;
  rotation?: VideoRotation;
  message?: string;
}

export interface CandidateReport {
  candidateType?: string;
  address?: string;
  ip?: string;
  url?: string;
  protocol?: string;
  port?: number;
}

export interface CandidatePairReport {
  localCandidateId?: string;
  remoteCandidateId?: string;
  selected?: boolean;
}

export interface TransportReport {
  selectedCandidatePairId?: string;
}

export interface InboundVideoReport {
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  framesDecoded?: number;
  framesDropped?: number;
  freezeCount?: number;
}

export type StatsReport = RTCStats & Record<string, unknown>;
