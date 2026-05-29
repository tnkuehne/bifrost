import { els, localVideo, remoteVideo } from "./dom";
import { createRoom as createSignalingRoom, openSignaling } from "./signaling";
import type { AppState, CameraSettingsMessage, Mode, Role, SignalMessage } from "./types";
import { createUi } from "./ui";
import { errorMessage, isAllowedCandidate } from "./utils";
import { createVideoMonitor } from "./video-monitor";

const ICE_SERVERS: RTCIceServer[] = [];
const ICE_CONFIG: RTCConfiguration = Object.freeze({
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 0,
});
const urlParams = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
const requestedMode = urlParams.get("mode") || hashParams.get("mode");
const path = location.pathname;
const mode: Mode =
  requestedMode === "camera" || requestedMode === "obs" || requestedMode === "receiver"
    ? requestedMode
    : path.includes("camera")
      ? "camera"
      : path.includes("obs")
        ? "obs"
        : "receiver";
const role: Role = mode === "camera" ? "camera" : "receiver";
const state: AppState = {
  room: getRoomFromUrl(),
  ws: null,
  pc: null,
  stream: null,
  facingMode: "environment",
  pendingCandidates: [],
  startedCamera: false,
  receiverActive: mode === "obs",
  statsTimer: 0,
  incomingFrames: 0,
  lastIncomingAt: 0,
  lastFrameSampleAt: 0,
  orientationTimer: 0,
  debug: urlParams.get("debug") === "1" || hashParams.get("debug") === "1",
};
const {
  copyText,
  fail,
  log,
  renderCameraFormat,
  setStatus,
  updateCameraControls,
  updateDebugMode,
  updateLinks,
  updatePageState,
} = createUi(state, mode);
const videoMonitor = createVideoMonitor(state, {
  fail,
  log,
  closePeerConnection,
});

init().catch((error: unknown) => fail(errorMessage(error)));

async function init(): Promise<void> {
  remoteVideo.autoplay = true;
  remoteVideo.muted = true;
  remoteVideo.playsInline = true;
  for (const eventName of ["pointerdown", "touchend", "keydown"]) {
    document.addEventListener(
      eventName,
      () => videoMonitor.tryPlayRemoteVideo("user interaction"),
      {
        once: true,
      },
    );
  }

  document.body.classList.toggle("obs", mode === "obs");
  document.body.classList.toggle("camera", mode === "camera");
  els.title.textContent =
    mode === "camera" ? "Camera" : mode === "obs" ? "OBS Receiver" : "Receiver";
  els.receiverPanel.classList.toggle("hidden", mode === "camera");
  els.cameraPanel.classList.toggle("hidden", mode !== "camera");
  els.receiverFrame.classList.toggle("hidden", mode === "camera");
  els.cameraFrame.classList.toggle("hidden", mode !== "camera");
  els.summaryPanel.classList.toggle("hidden", mode === "camera");
  els.pageRole.textContent = `${mode} (${role})`;
  els.iceServers.textContent = `${ICE_SERVERS.length} configured`;
  updateDebugMode();
  updateCameraControls();

  updatePageState();

  wireControls();

  if (!state.room && role === "receiver" && mode !== "obs") {
    await createRoom();
  }

  if (!state.room) {
    fail("Missing room. Open the receiver page first and use its phone or OBS link.");
    return;
  }

  updateLinks();
  connectSignaling();

  if (mode === "camera") {
    watchCameraOrientation();
    setStatus("waiting", "Camera permission", "Your browser should ask for camera access.");
    startCamera().catch((error: unknown) => {
      log(`Auto-start did not complete: ${errorMessage(error)}`);
      setStatus(
        "waiting",
        "Tap Start Camera",
        "Your browser may require a tap before camera access.",
      );
    });
  } else {
    setStatus(
      "waiting",
      "Waiting for phone",
      "Open the phone camera link on the same local network.",
    );
  }
}

function wireControls() {
  els.toggleDebug.addEventListener("click", () => {
    state.debug = !state.debug;
    updateDebugMode();
    const nextUrl = new URL(location.href);
    if (state.debug) {
      nextUrl.searchParams.set("debug", "1");
    } else {
      nextUrl.searchParams.delete("debug");
    }
    history.replaceState(null, "", nextUrl);
    updateLinks();
  });
  els.copyObsLink.addEventListener("click", () => copyText(els.obsLink.textContent));
  els.startCamera.addEventListener("click", () =>
    startCamera().catch((error: unknown) => fail(errorMessage(error))),
  );
  els.switchCamera.addEventListener("click", () =>
    switchCamera().catch((error: unknown) => fail(errorMessage(error))),
  );
}

async function createRoom(): Promise<void> {
  state.room = await createSignalingRoom();
  location.hash = `room=${state.room}`;
}

function connectSignaling(): void {
  if (!state.room) {
    return;
  }

  state.ws = openSignaling({
    room: state.room,
    role,
    mode,
    onOpen: (clientMode) => {
      log(`Signaling connected as ${role} (${clientMode}).`);
      sendSignal({ type: "hello" });
    },
    onMessage: (message) => {
      void handleSignal(message);
    },
    onClose: (event) => {
      log(
        `Signaling closed (${event.code || "no code"}, ${event.wasClean ? "clean" : "unclean"}).`,
      );
      if (state.pc?.connectionState === "connected") {
        setStatus(
          "good",
          "Media still connected",
          "Signaling closed after setup; media path is still direct.",
        );
        return;
      }
      if (event.code === 4000 && mode === "receiver") {
        resetPeerConnection();
        setStatus(
          "waiting",
          "Receiver preview replaced",
          "Another receiver page is active for this room.",
        );
        return;
      }
      if (!event.wasClean) {
        fail(`Signaling closed (${event.code}).`);
      }
    },
    onError: () => {
      log("Signaling WebSocket error.");
      if (state.pc?.connectionState !== "connected") {
        fail("Signaling WebSocket failed.");
      }
    },
  });
}

async function handleSignal(message: SignalMessage): Promise<void> {
  if (message.type === "joined") {
    log(`Room ${state.room} joined.`);
    if (role === "receiver") {
      state.receiverActive = message.receiverActive !== false;
      if (!state.receiverActive) {
        resetPeerConnection();
        setStatus(
          "waiting",
          "OBS receiver active",
          "This page stays available for pairing and will preview when OBS disconnects.",
        );
        return;
      }
    }
    if (role === "receiver" && state.receiverActive && message.peers?.includes("camera")) {
      await startReceiverOffer();
    }
    return;
  }

  if (message.type === "receiver-deactivated") {
    state.receiverActive = false;
    resetPeerConnection();
    setStatus(
      "waiting",
      "OBS receiver active",
      "This page stays available for pairing and will preview when OBS disconnects.",
    );
    log("Receiver preview paused because OBS became active.");
    return;
  }

  if (message.type === "receiver-activated") {
    state.receiverActive = true;
    setStatus(
      "waiting",
      "Receiver preview active",
      "OBS is not connected, so this page can show the phone video.",
    );
    log("Receiver preview became active.");
    if (message.peers?.includes("camera")) {
      await startReceiverOffer();
    }
    return;
  }

  if (message.type === "peer-joined") {
    log(`${message.role} connected.`);
    if (message.role !== role && (role === "camera" || state.receiverActive)) {
      resetPeerConnection();
    }
    if (role === "receiver" && state.receiverActive && message.role === "camera") {
      await startReceiverOffer();
    }
    return;
  }

  if (message.type === "peer-left") {
    log(`${message.role} disconnected.`);
    if (message.role === role) {
      log("Another page with this role left.");
      return;
    }
    resetPeerConnection();
    setStatus("waiting", "Peer disconnected", "Reconnect the phone camera page to resume.");
    return;
  }

  if (message.type === "offer" && role === "camera") {
    if (message.description) {
      await answerOffer(message.description);
    }
    return;
  }

  if (message.type === "answer" && role === "receiver") {
    if (!message.description) {
      fail("Answer is missing a session description.");
      return;
    }
    const pc = await ensurePeerConnection();
    await pc.setRemoteDescription(message.description);
    await flushPendingCandidates();
    log("Receiver accepted the camera answer.");
    return;
  }

  if (message.type === "ice") {
    await receiveIceCandidate(message.candidate ?? null);
    return;
  }

  if (message.type === "camera-meta") {
    renderCameraFormat(message.settings, "Browser returned");
    return;
  }

  if (message.type === "error") {
    fail(String(message.message || "Signaling error"));
  }
}

async function ensurePeerConnection(): Promise<RTCPeerConnection> {
  if (state.pc) {
    return state.pc;
  }

  const pc = new RTCPeerConnection(ICE_CONFIG);
  state.pc = pc;

  pc.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      return;
    }
    const candidate = event.candidate.candidate || "";
    if (!isAllowedCandidate(candidate)) {
      fail("A non-local ICE candidate was produced. Closing instead of using it.");
      closePeerConnection();
      return;
    }
    sendSignal({ type: "ice", candidate: event.candidate });
  });

  pc.addEventListener("track", (event) => {
    const [stream] = event.streams;
    if (!stream) {
      fail("Remote video track arrived without a media stream.");
      return;
    }
    remoteVideo.srcObject = stream;
    videoMonitor.tryPlayRemoteVideo("track received");
    setStatus("good", "Video connected", "OBS can capture this receiver page.");
    videoMonitor.trackIncomingVideo();
    videoMonitor.startStatsPolling();
  });

  pc.addEventListener("connectionstatechange", () => {
    log(`Peer connection: ${pc.connectionState}`);
    if (pc.connectionState === "connected") {
      setStatus("good", "Direct WebRTC connected", "Verify the selected ICE path below.");
      videoMonitor.startStatsPolling();
    }
    if (["failed", "closed"].includes(pc.connectionState)) {
      fail("Direct WebRTC connection failed. No relay fallback is configured.");
    }
  });

  pc.addEventListener("iceconnectionstatechange", () => {
    log(`ICE: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === "failed") {
      fail(
        "ICE failed locally. Check that both devices are on the same LAN or USB-tethered network.",
      );
    }
  });

  return pc;
}

async function startReceiverOffer(): Promise<void> {
  if (role !== "receiver" || !state.receiverActive) {
    return;
  }
  resetPeerConnection();
  const pc = await ensurePeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (!pc.localDescription) {
    fail("Could not create a receiver offer.");
    return;
  }
  sendSignal({ type: "offer", description: pc.localDescription });
  setStatus("waiting", "Offer sent", "Waiting for phone camera answer.");
  log("Receiver offer sent.");
}

async function answerOffer(description: RTCSessionDescriptionInit): Promise<void> {
  const stream = await startCamera();
  resetPeerConnection();
  const pc = await ensurePeerConnection();
  for (const track of stream.getTracks()) {
    const sender = pc.addTrack(track, stream);
    if (track.kind === "video") {
      await tuneVideoSender(sender, track);
    }
  }
  await pc.setRemoteDescription(description);
  await flushPendingCandidates();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  if (!pc.localDescription) {
    fail("Could not create a camera answer.");
    return;
  }
  sendSignal({ type: "answer", description: pc.localDescription });
  sendCameraMeta();
  setStatus("waiting", "Answer sent", "Waiting for local ICE to connect.");
  log("Camera answer sent.");
}

async function receiveIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
  if (!candidate || !isAllowedCandidate(candidate.candidate || "")) {
    fail("A peer sent a non-local ICE candidate. Closing instead of using it.");
    closePeerConnection();
    return;
  }

  const pc = await ensurePeerConnection();
  if (!pc.remoteDescription) {
    state.pendingCandidates.push(candidate);
    return;
  }
  await pc.addIceCandidate(candidate);
}

async function flushPendingCandidates(): Promise<void> {
  const pc = state.pc;
  if (!pc) {
    return;
  }
  while (state.pendingCandidates.length) {
    const candidate = state.pendingCandidates.shift();
    if (candidate) {
      await pc.addIceCandidate(candidate);
    }
  }
}

async function startCamera(): Promise<MediaStream> {
  if (state.stream) {
    return state.stream;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support camera capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: state.facingMode },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30 },
    },
  });
  state.stream = stream;
  localVideo.srcObject = stream;
  state.startedCamera = true;
  updateCameraControls();
  renderCameraFormat(getVideoSettings(), "Browser returned");
  sendCameraMeta();
  setStatus("good", "Camera ready", "Waiting for the receiver.");
  log("Camera permission granted.");
  return stream;
}

function watchCameraOrientation(): void {
  const scheduleRefresh = () => {
    if (!state.stream) {
      return;
    }
    clearTimeout(state.orientationTimer);
    state.orientationTimer = window.setTimeout(() => {
      refreshCameraForOrientation().catch((error) =>
        log(`Camera orientation refresh failed: ${errorMessage(error)}`),
      );
    }, 500);
  };

  window.addEventListener("orientationchange", scheduleRefresh);
  window.addEventListener("resize", scheduleRefresh);
  screen.orientation?.addEventListener?.("change", scheduleRefresh);
}

async function refreshCameraForOrientation(): Promise<void> {
  if (mode !== "camera" || !state.stream) {
    return;
  }
  const sender = state.pc?.getSenders().find((item) => item.track?.kind === "video");
  const oldStream = state.stream;
  state.stream = null;
  for (const track of oldStream.getTracks()) {
    track.stop();
  }
  const stream = await startCamera();
  const [track] = stream.getVideoTracks();
  if (sender && track) {
    await sender.replaceTrack(track);
    await tuneVideoSender(sender, track);
  }
  log("Camera refreshed after orientation change.");
}

async function switchCamera(): Promise<void> {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
    updateCameraControls();
  }
  const stream = await startCamera();
  if (state.pc) {
    const [track] = stream.getVideoTracks();
    const sender = state.pc.getSenders().find((item) => item.track?.kind === "video");
    if (sender && track) {
      await sender.replaceTrack(track);
      await tuneVideoSender(sender, track);
    }
  }
}

async function tuneVideoSender(sender: RTCRtpSender, track: MediaStreamTrack): Promise<void> {
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

  try {
    await sender.setParameters(parameters);
    els.senderFormat.textContent = `balanced adaptive, ${Math.round(maxBitrate / 1_000_000)} Mbps cap`;
    log("Video sender tuned for balanced adaptation.");
  } catch (error) {
    els.senderFormat.textContent = "Browser ignored sender tuning";
    log(`Sender tuning skipped: ${errorMessage(error)}`);
  }
}

function sendCameraMeta(): void {
  const settings = getVideoSettings();
  if (settings) {
    sendSignal({ type: "camera-meta", settings });
  }
}

function getVideoSettings(): CameraSettingsMessage | null {
  const [track] = state.stream?.getVideoTracks() || [];
  if (!track) {
    els.trackState.textContent = "No track";
    return null;
  }
  const settings = track.getSettings();
  els.trackState.textContent = `${track.readyState}, ${settings.facingMode || "unknown"} camera`;
  return {
    width: settings.width || null,
    height: settings.height || null,
    frameRate: settings.frameRate || null,
    facingMode: settings.facingMode || null,
  };
}

function sendSignal(message: SignalMessage): void {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(message));
  }
}

function getRoomFromUrl(): string | null {
  if (urlParams.has("room")) {
    return urlParams.get("room");
  }
  return hashParams.get("room");
}

function resetPeerConnection(): void {
  closePeerConnection();
  state.pendingCandidates = [];
  remoteVideo.srcObject = null;
}

function closePeerConnection(): void {
  if (state.pc) {
    state.pc.close();
    state.pc = null;
  }
  if (state.statsTimer) {
    clearInterval(state.statsTimer);
    state.statsTimer = 0;
  }
}
