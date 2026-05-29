import { isAllowedCandidate } from "./utils";

const ICE_SERVERS: RTCIceServer[] = [];

const ICE_CONFIG: RTCConfiguration = Object.freeze({
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 0,
});

type PeerConnectionHandlers = {
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onRejectedCandidate: () => void;
  onTrack: (event: RTCTrackEvent) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onIceConnectionState: (state: RTCIceConnectionState) => void;
};

export function getIceServerCount(): number {
  return ICE_SERVERS.length;
}

export function createLocalOnlyPeerConnection(handlers: PeerConnectionHandlers): RTCPeerConnection {
  const peer = new RTCPeerConnection(ICE_CONFIG);

  peer.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      return;
    }
    const candidate = event.candidate.candidate || "";
    if (!isAllowedCandidate(candidate)) {
      handlers.onRejectedCandidate();
      return;
    }
    handlers.onIceCandidate(event.candidate);
  });

  peer.addEventListener("track", handlers.onTrack);
  peer.addEventListener("connectionstatechange", () => {
    handlers.onConnectionState(peer.connectionState);
  });
  peer.addEventListener("iceconnectionstatechange", () => {
    handlers.onIceConnectionState(peer.iceConnectionState);
  });

  return peer;
}

export function isLocalOnlyCandidate(
  candidate: RTCIceCandidateInit | null,
): candidate is RTCIceCandidateInit {
  return Boolean(candidate?.candidate && isAllowedCandidate(candidate.candidate));
}
