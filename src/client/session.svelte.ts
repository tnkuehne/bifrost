import { onCleanup, useDebounce, useEventListener, useInterval } from "runed";
import { createRoom as createSignalingRoom, openSignaling } from "./signaling";
import type { CameraSettingsMessage, Mode, Role, SignalMessage, StatusKind } from "./types";
import { errorMessage, round } from "./utils";
import { renderPairingQr } from "./qr";
import {
  getCameraConstraints,
  getVideoSettings as readVideoSettings,
  tuneVideoSender as applyVideoSenderTuning,
} from "./camera";
import {
  createLocalOnlyPeerConnection,
  getIceServerCount,
  isLocalOnlyCandidate,
} from "./peer-connection";
import { readPathDiagnostics } from "./receiver-diagnostics";
import { createRemoteVideoMonitor } from "./remote-video";
import {
  buildPairingUrls,
  persistDebugInUrl,
  persistRoomInUrl,
  readSessionRoute,
} from "./session-url";

export function createWebcamSession() {
  const route = readSessionRoute(location);
  const mode: Mode = route.mode;
  const role: Role = route.role;

  let localVideo: HTMLVideoElement | null = null;

  let room = route.room;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let stream = $state<MediaStream | null>(null);
  let facingMode: "environment" | "user" = "environment";
  let pendingCandidates: RTCIceCandidateInit[] = [];
  let receiverActive = mode === "obs";
  let debug = $state(route.debug);
  let hasRemoteVideo = $state(false);

  let statusKind = $state<StatusKind>("waiting");
  let statusTitle = $state("Starting");
  let statusDetail = $state("");
  let cameraQr = $state("");
  let cameraUrl = $state("");
  let obsUrl = $state("");
  let copyLabel = $state("Copy OBS URL");
  let copyDisabled = $state(false);
  let copyResetTimer = 0;

  let cameraSummary = $state("Waiting");
  let incomingSummary = $state("Waiting");
  let pathSummary = $state("Local direct only");
  let cameraFormat = $state("Waiting");
  let senderFormat = $state("Balanced adaptive");
  let trackState = $state("No track");
  let incomingFormat = $state("Waiting");
  let videoElementState = $state("Waiting");
  let frameSample = $state("Waiting");
  let inboundStats = $state("Waiting");
  let selectedPath = $state("Waiting");
  let localCandidate = $state("Waiting");
  let remoteCandidate = $state("Waiting");
  let relayState = $state("Blocked by configuration");
  let events = $state<string[]>([]);

  const remoteVideo = createRemoteVideoMonitor({
    onIncomingFormat: (format, summary) => {
      incomingFormat = format;
      incomingSummary = summary;
    },
    onElementState: (state) => {
      videoElementState = state;
    },
    onFrameSample: (sample) => {
      frameSample = sample;
    },
    onLog: (message) => log(message),
  });

  const title = mode === "camera" ? "Camera" : mode === "obs" ? "OBS Receiver" : "Receiver";
  let pairing = $derived(!hasRemoteVideo && mode !== "camera" && mode !== "obs");
  let showDebug = $derived(debug && mode !== "obs");

  const refreshCameraAfterOrientationChange = useDebounce(() => {
    refreshCameraForOrientation().catch((error) =>
      log(`Camera orientation refresh failed: ${errorMessage(error)}`),
    );
  }, 500);
  const statsPoller = useInterval(1200, {
    immediate: false,
    immediateCallback: true,
    callback: () => {
      void pollSelectedPath();
    },
  });

  useEventListener(
    document,
    ["pointerdown", "touchend", "keydown"],
    () => {
      remoteVideo.tryPlay("user interaction");
    },
    { once: true },
  );
  useEventListener(window, ["orientationchange", "resize"], () => scheduleCameraRefresh());
  useEventListener(
    () => globalThis.screen?.orientation ?? null,
    "change",
    () => scheduleCameraRefresh(),
  );
  onCleanup(() => {
    closePeerConnection();
    ws?.close();
    stream?.getTracks().forEach((track) => track.stop());
    window.clearTimeout(copyResetTimer);
  });

  function mount(): () => void {
    init().catch((error: unknown) => fail(errorMessage(error)));
    return () => {};
  }

  async function init(): Promise<void> {
    if (!room && role === "receiver" && mode !== "obs") {
      await createRoom();
    }

    if (!room) {
      fail("Missing room. Open the receiver page first and use its phone or OBS link.");
      return;
    }

    await updateLinks();
    connectSignaling();

    if (mode === "camera") {
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

  async function createRoom(): Promise<void> {
    room = await createSignalingRoom();
    persistRoomInUrl(room);
  }

  function connectSignaling(): void {
    if (!room) {
      return;
    }

    ws = openSignaling({
      room,
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
        if (pc?.connectionState === "connected") {
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
        if (pc?.connectionState !== "connected") {
          fail("Signaling WebSocket failed.");
        }
      },
    });
  }

  async function handleSignal(message: SignalMessage): Promise<void> {
    if (message.type === "joined") {
      log(`Room ${room} joined.`);
      if (role === "receiver") {
        receiverActive = message.receiverActive !== false;
        if (!receiverActive) {
          resetPeerConnection();
          setStatus(
            "waiting",
            "OBS receiver active",
            "This page stays available for pairing and will preview when OBS disconnects.",
          );
          return;
        }
      }
      if (role === "receiver" && receiverActive && message.peers?.includes("camera")) {
        await startReceiverOffer();
      }
      return;
    }

    if (message.type === "receiver-deactivated") {
      receiverActive = false;
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
      receiverActive = true;
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
      if (message.role !== role && (role === "camera" || receiverActive)) {
        resetPeerConnection();
      }
      if (role === "receiver" && receiverActive && message.role === "camera") {
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
      const peer = await ensurePeerConnection();
      await peer.setRemoteDescription(message.description);
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
    if (pc) {
      return pc;
    }

    const peer = createLocalOnlyPeerConnection({
      onIceCandidate: (candidate) => {
        sendSignal({ type: "ice", candidate });
      },
      onRejectedCandidate: () => {
        fail("A non-local ICE candidate was produced. Closing instead of using it.");
        closePeerConnection();
      },
      onTrack: (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream || !remoteVideo.attachStream(remoteStream)) {
          fail("Remote video track arrived without a media stream.");
          return;
        }
        hasRemoteVideo = true;
        remoteVideo.tryPlay("track received");
        setStatus("good", "Video connected", "OBS can capture this receiver page.");
        remoteVideo.trackIncomingVideo();
        startStatsPolling();
      },
      onConnectionState: (state) => {
        log(`Peer connection: ${state}`);
        if (state === "connected") {
          setStatus("good", "Direct WebRTC connected", "Verify the selected ICE path below.");
          startStatsPolling();
        }
        if (["failed", "closed"].includes(state)) {
          fail("Direct WebRTC connection failed. No relay fallback is configured.");
        }
      },
      onIceConnectionState: (state) => {
        log(`ICE: ${state}`);
        if (state === "failed") {
          fail(
            "ICE failed locally. Check that both devices are on the same LAN or USB-tethered network.",
          );
        }
      },
    });
    pc = peer;

    return peer;
  }

  async function startReceiverOffer(): Promise<void> {
    if (role !== "receiver" || !receiverActive) {
      return;
    }
    resetPeerConnection();
    const peer = await ensurePeerConnection();
    peer.addTransceiver("video", { direction: "recvonly" });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (!peer.localDescription) {
      fail("Could not create a receiver offer.");
      return;
    }
    sendSignal({ type: "offer", description: peer.localDescription });
    setStatus("waiting", "Offer sent", "Waiting for phone camera answer.");
    log("Receiver offer sent.");
  }

  async function answerOffer(description: RTCSessionDescriptionInit): Promise<void> {
    const localStream = await startCamera();
    resetPeerConnection();
    const peer = await ensurePeerConnection();
    for (const track of localStream.getTracks()) {
      const sender = peer.addTrack(track, localStream);
      if (track.kind === "video") {
        await tuneVideoSender(sender, track);
      }
    }
    await peer.setRemoteDescription(description);
    await flushPendingCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (!peer.localDescription) {
      fail("Could not create a camera answer.");
      return;
    }
    sendSignal({ type: "answer", description: peer.localDescription });
    sendCameraMeta();
    setStatus("waiting", "Answer sent", "Waiting for local ICE to connect.");
    log("Camera answer sent.");
  }

  async function receiveIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!isLocalOnlyCandidate(candidate)) {
      fail("A peer sent a non-local ICE candidate. Closing instead of using it.");
      closePeerConnection();
      return;
    }

    const peer = await ensurePeerConnection();
    if (!peer.remoteDescription) {
      pendingCandidates = [...pendingCandidates, candidate];
      return;
    }
    await peer.addIceCandidate(candidate);
  }

  async function flushPendingCandidates(): Promise<void> {
    if (!pc) {
      return;
    }
    while (pendingCandidates.length) {
      const [candidate, ...remaining] = pendingCandidates;
      pendingCandidates = remaining;
      if (candidate) {
        await pc.addIceCandidate(candidate);
      }
    }
  }

  async function startCamera(): Promise<MediaStream> {
    if (stream) {
      return stream;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support camera capture.");
    }

    const nextStream = await navigator.mediaDevices.getUserMedia(getCameraConstraints(facingMode));
    stream = nextStream;
    if (localVideo) {
      localVideo.srcObject = nextStream;
    }
    renderCameraFormat(getVideoSettings(), "Browser returned");
    sendCameraMeta();
    setStatus("good", "Camera ready", "Waiting for the receiver.");
    log("Camera permission granted.");
    return nextStream;
  }

  function scheduleCameraRefresh(): void {
    if (stream) {
      void refreshCameraAfterOrientationChange();
    }
  }

  async function refreshCameraForOrientation(): Promise<void> {
    if (mode !== "camera" || !stream) {
      return;
    }
    const sender = pc?.getSenders().find((item) => item.track?.kind === "video");
    const oldStream = stream;
    stream = null;
    for (const track of oldStream.getTracks()) {
      track.stop();
    }
    const nextStream = await startCamera();
    const [track] = nextStream.getVideoTracks();
    if (sender && track) {
      await sender.replaceTrack(track);
      await tuneVideoSender(sender, track);
    }
    log("Camera refreshed after orientation change.");
  }

  async function switchCamera(): Promise<void> {
    facingMode = facingMode === "environment" ? "user" : "environment";
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    const nextStream = await startCamera();
    if (pc) {
      const [track] = nextStream.getVideoTracks();
      const sender = pc.getSenders().find((item) => item.track?.kind === "video");
      if (sender && track) {
        await sender.replaceTrack(track);
        await tuneVideoSender(sender, track);
      }
    }
  }

  async function tuneVideoSender(sender: RTCRtpSender, track: MediaStreamTrack): Promise<void> {
    try {
      const result = await applyVideoSenderTuning(sender, track);
      senderFormat = result.label;
      log("Video sender tuned for balanced adaptation.");
    } catch (error) {
      senderFormat = "Browser ignored sender tuning";
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
    const snapshot = readVideoSettings(stream);
    trackState = snapshot.trackState;
    return snapshot.settings;
  }

  function renderCameraFormat(
    settings: CameraSettingsMessage | null | undefined,
    prefix: string,
  ): void {
    if (!settings) {
      cameraFormat = "Waiting";
      return;
    }
    const fps = settings.frameRate ? `${round(settings.frameRate)} fps` : "fps unknown";
    const size =
      settings.width && settings.height ? `${settings.width} x ${settings.height}` : "size unknown";
    cameraFormat = `${prefix}: ${size} at ${fps}`;
    cameraSummary = `${size} @ ${fps}`;
  }

  function startStatsPolling(): void {
    if (!statsPoller.isActive) {
      statsPoller.resume();
    }
  }

  async function pollSelectedPath(): Promise<void> {
    if (!pc) {
      return;
    }
    const diagnostics = await readPathDiagnostics(pc, remoteVideo.video);
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
      fail("A relay candidate was selected. Closing instead of carrying media through a relay.");
      closePeerConnection();
    }
  }

  function sendSignal(message: SignalMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  async function updateLinks(): Promise<void> {
    if (!room || mode === "camera") {
      return;
    }
    const urls = buildPairingUrls(room, debug);
    cameraUrl = urls.cameraUrl;
    obsUrl = urls.obsUrl;
    try {
      cameraQr = await renderPairingQr(cameraUrl);
    } catch (error) {
      fail(`QR generation failed: ${errorMessage(error)}`);
    }
  }

  async function copyObsUrl(): Promise<void> {
    if (!obsUrl) {
      return;
    }
    copyDisabled = true;
    copyLabel = "Copying...";
    try {
      await navigator.clipboard.writeText(obsUrl);
      copyLabel = "Copied";
      log("Link copied.");
    } catch {
      copyLabel = "Copy failed";
      log("Copy failed. Select the link text manually.");
    } finally {
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        copyDisabled = false;
        copyLabel = "Copy OBS URL";
      }, 1200);
    }
  }

  function toggleDebug(): void {
    debug = !debug;
    persistDebugInUrl(debug);
    updateLinks();
  }

  function setStatus(kind: StatusKind, title: string, detail?: string): void {
    statusKind = kind;
    statusTitle = title;
    statusDetail = detail || "";
  }

  function fail(message: string): void {
    setStatus("bad", "Failed", message);
    log(message);
  }

  function resetPeerConnection(): void {
    closePeerConnection();
    pendingCandidates = [];
    remoteVideo.clear();
    hasRemoteVideo = false;
  }

  function closePeerConnection(): void {
    if (pc) {
      pc.close();
      pc = null;
    }
    statsPoller.pause();
    hasRemoteVideo = false;
  }

  function log(message: string): void {
    events = [`${new Date().toLocaleTimeString()} ${message}`, ...events].slice(0, 8);
  }

  function setRemoteVideo(node: HTMLVideoElement): void {
    remoteVideo.setVideo(node);
  }

  function setLocalVideo(node: HTMLVideoElement): void {
    localVideo = node;
    if (stream) {
      localVideo.srcObject = stream;
    }
  }

  function startCameraFromUi(): void {
    startCamera().catch((error) => fail(errorMessage(error)));
  }

  function switchCameraFromUi(): void {
    switchCamera().catch((error) => fail(errorMessage(error)));
  }

  return {
    get mode() {
      return mode;
    },
    get role() {
      return role;
    },
    get title() {
      return title;
    },
    get debug() {
      return debug;
    },
    get pairing() {
      return pairing;
    },
    get showDebug() {
      return showDebug;
    },
    get hasRemoteVideo() {
      return hasRemoteVideo;
    },
    get statusKind() {
      return statusKind;
    },
    get statusTitle() {
      return statusTitle;
    },
    get statusDetail() {
      return statusDetail;
    },
    get cameraQr() {
      return cameraQr;
    },
    get cameraUrl() {
      return cameraUrl;
    },
    get obsUrl() {
      return obsUrl;
    },
    get copyLabel() {
      return copyLabel;
    },
    get copyDisabled() {
      return copyDisabled;
    },
    get hasStream() {
      return Boolean(stream);
    },
    get cameraSummary() {
      return cameraSummary;
    },
    get incomingSummary() {
      return incomingSummary;
    },
    get pathSummary() {
      return pathSummary;
    },
    get cameraFormat() {
      return cameraFormat;
    },
    get senderFormat() {
      return senderFormat;
    },
    get trackState() {
      return trackState;
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
    get events() {
      return events;
    },
    get iceServersCount() {
      return getIceServerCount();
    },
    mount,
    toggleDebug,
    copyObsUrl,
    setRemoteVideo,
    setLocalVideo,
    startCameraFromUi,
    switchCameraFromUi,
  };
}
