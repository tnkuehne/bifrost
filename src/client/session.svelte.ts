import { onCleanup, useDebounce, useEventListener, useInterval } from "runed";
import { createRoom as createSignalingRoom, openSignaling } from "./signaling";
import type { Mode, Role, SignalMessage, StatusKind, VideoRotation } from "./types";
import { errorMessage } from "./utils";
import { createLocalOnlyPeerConnection, isLocalOnlyCandidate } from "./peer-connection";
import { createReceiverVideo } from "./receiver-video.svelte";
import { createLocalCamera } from "./local-camera.svelte";
import { createPairingLinks } from "./pairing-links.svelte";
import { createDeviceOrientation } from "./device-orientation.svelte";
import { persistDebugInUrl, persistRoomInUrl, readSessionRoute } from "./session-url";
import { getBrowserWarning } from "./browser-support";

export function createWebcamSession() {
  const route = readSessionRoute(location);
  const mode: Mode = route.mode;
  const role: Role = route.role;

  let room = route.room;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let pendingCandidates: RTCIceCandidateInit[] = [];
  let receiverActive = $state(mode === "obs");
  let debug = $state(route.debug);
  let hasRemoteVideo = $state(false);
  let remoteVideoRotation = $state<VideoRotation>(0);

  let statusKind = $state<StatusKind>("waiting");
  let statusTitle = $state("Starting");
  let statusDetail = $state("");
  const browserWarning = getBrowserWarning();

  const receiverVideo = createReceiverVideo({
    onRelayDetected: () => {
      fail(
        "A relay candidate was selected. Closing instead of carrying media through a relay.",
        "relay_candidate",
      );
      closePeerConnection();
    },
    onLog: (message) => log(message),
  });
  const localCamera = createLocalCamera({
    onMeta: (settings) => sendSignal({ type: "camera-meta", settings }),
    onRotation: (rotation) => sendSignal({ type: "camera-orientation", rotation }),
    onReady: () => setStatus("waiting", "Waiting for receiver", "Keep this page open."),
    onLog: (message) => log(message),
  });
  const deviceOrientation = createDeviceOrientation({
    onOrientation: (orientation) => localCamera.setPhysicalOrientation(orientation),
    onLog: (message) => log(message),
  });
  const pairingLinks = createPairingLinks({
    onError: (message) => fail(message, "room_create"),
    onLog: (message) => log(message),
  });

  const title = mode === "camera" ? "Camera" : mode === "obs" ? "OBS Receiver" : "Receiver";
  let pairing = $derived(!hasRemoteVideo && mode !== "camera" && mode !== "obs");
  let obsReceiverActive = $derived(mode === "receiver" && !receiverActive);
  let canDebug = $derived(mode !== "obs" && (mode !== "receiver" || receiverActive));
  let showDebug = $derived(debug && canDebug);

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
      receiverVideo.tryPlay("user interaction");
    },
    { once: true },
  );
  useEventListener(window, ["orientationchange", "resize"], () => scheduleCameraRefresh());
  useEventListener(document, ["pointerdown", "touchend"], () => {
    enableDeviceOrientation().catch((error) =>
      log(`Device orientation permission failed: ${errorMessage(error)}`),
    );
  });
  useEventListener(
    () => globalThis.screen?.orientation ?? null,
    "change",
    () => scheduleCameraRefresh(),
  );
  onCleanup(() => {
    closePeerConnection();
    ws?.close();
    deviceOrientation.stop();
    localCamera.stop();
  });

  function mount(): void {
    init().catch((error: unknown) => fail(errorMessage(error), "client_error"));
  }

  async function init(): Promise<void> {
    if (!room && role === "receiver" && mode !== "obs") {
      await createRoom();
    }

    if (!room) {
      fail(
        "Missing room. Open the receiver page first and use its phone or OBS link.",
        "missing_room",
      );
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
        if (browserWarning) {
          sendSignal({ type: "client-failed", reason: "unsupported_browser" });
        }
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
          fail(`Signaling closed (${event.code}).`, "signaling_closed");
        }
      },
      onError: () => {
        log("Signaling WebSocket error.");
        if (pc?.connectionState !== "connected") {
          fail("Signaling WebSocket failed.", "signaling_closed");
        }
      },
    });
  }

  async function handleSignal(message: SignalMessage): Promise<void> {
    if (message.type === "joined") {
      log(`Room ${room} joined.`);
      if (role === "receiver") {
        setReceiverActive(message.receiverActive !== false);
        if (!receiverActive) {
          resetPeerConnection();
          setObsReceiverStatus();
          return;
        }
      }
      if (role === "receiver" && receiverActive && message.peers?.includes("camera")) {
        await startReceiverOffer();
      }
      return;
    }

    if (message.type === "receiver-deactivated") {
      setReceiverActive(false);
      resetPeerConnection();
      setObsReceiverStatus();
      log("Receiver preview paused because OBS became active.");
      return;
    }

    if (message.type === "receiver-activated") {
      setReceiverActive(true);
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
      if (role === "receiver" && !receiverActive) {
        setObsReceiverStatus();
        return;
      }
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
      if (role === "receiver" && !receiverActive) {
        setObsReceiverStatus();
        return;
      }
      if (message.role === role) {
        log("Another page with this role left.");
        return;
      }
      if (pc?.connectionState === "connected") {
        log("Ignoring peer-left because WebRTC media is still connected.");
        refreshConnectedStatus();
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
        fail("Answer is missing a session description.", "invalid_signal");
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
      localCamera.renderSettings(message.settings, "Browser returned");
      return;
    }

    if (message.type === "camera-orientation") {
      remoteVideoRotation = message.rotation ?? 0;
      return;
    }

    if (message.type === "error") {
      fail(String(message.message || "Signaling error"), "signaling_error");
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
        fail(
          "A non-local ICE candidate was produced. Closing instead of using it.",
          "relay_candidate",
        );
        closePeerConnection();
      },
      onTrack: (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream || !receiverVideo.attachStream(remoteStream)) {
          fail("Remote video track arrived without a media stream.", "media_track");
          return;
        }
        hasRemoteVideo = true;
        receiverVideo.tryPlay("track received");
        setStatus("good", "Video connected", "OBS can capture this receiver page.");
        receiverVideo.trackIncomingVideo();
        startStatsPolling();
      },
      onConnectionState: (state) => {
        log(`Peer connection: ${state}`);
        if (state === "connected") {
          sendSignal({ type: "webrtc-connected" });
          refreshConnectedStatus();
          startStatsPolling();
        }
        if (state === "failed") {
          sendSignal({ type: "webrtc-failed", reason: "connection_state" });
          fail(
            "Direct WebRTC connection failed. No relay fallback is configured.",
            "webrtc_failed",
          );
        }
      },
      onIceConnectionState: (state) => {
        log(`ICE: ${state}`);
        if (state === "failed") {
          sendSignal({ type: "webrtc-failed", reason: "ice_failed" });
          fail(
            "ICE failed locally. Check that both devices are on the same LAN or USB-tethered network.",
            "webrtc_failed",
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
      fail("Could not create a receiver offer.", "offer_create");
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
        await localCamera.tuneSender(sender, track);
      }
    }
    await peer.setRemoteDescription(description);
    await flushPendingCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (!peer.localDescription) {
      fail("Could not create a camera answer.", "answer_create");
      return;
    }
    sendSignal({ type: "answer", description: peer.localDescription });
    localCamera.publishSettings("Browser returned");
    setStatus("waiting", "Answer sent", "Waiting for local ICE to connect.");
    log("Camera answer sent.");
  }

  async function receiveIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!isLocalOnlyCandidate(candidate)) {
      fail(
        "A peer sent a non-local ICE candidate. Closing instead of using it.",
        "relay_candidate",
      );
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

  function scheduleCameraRefresh(): void {
    if (localCamera.hasStream) {
      void refreshCameraAfterOrientationChange();
    }
  }

  async function refreshCameraForOrientation(): Promise<void> {
    if (mode !== "camera" || !localCamera.hasStream) {
      return;
    }
    const sender = pc?.getSenders().find((item) => item.track?.kind === "video");
    await localCamera.refreshForOrientation(sender);
    refreshCameraStatus();
  }

  async function enableDeviceOrientation(): Promise<void> {
    if (mode === "camera") {
      await deviceOrientation.start();
    }
  }

  async function startCamera(): Promise<MediaStream> {
    await enableDeviceOrientation().catch((error) =>
      log(`Device orientation permission failed: ${errorMessage(error)}`),
    );
    let stream: MediaStream;
    try {
      stream = await localCamera.start();
    } catch (error) {
      sendSignal({ type: "client-failed", reason: "camera_permission" });
      throw error;
    }
    sendSignal({ type: "camera-ready" });
    await enableDeviceOrientation().catch((error) =>
      log(`Device orientation permission failed: ${errorMessage(error)}`),
    );
    return stream;
  }

  async function switchCamera(): Promise<void> {
    const sender = pc?.getSenders().find((item) => item.track?.kind === "video");
    await localCamera.switchCamera(sender);
    refreshCameraStatus();
  }

  async function toggleQuality(): Promise<void> {
    const sender = pc?.getSenders().find((item) => item.track?.kind === "video");
    await localCamera.toggleQuality(sender);
    refreshCameraStatus();
  }

  function refreshCameraStatus(): void {
    if (mode !== "camera") {
      return;
    }
    if (pc?.connectionState === "connected") {
      refreshConnectedStatus();
    }
  }

  function refreshConnectedStatus(): void {
    if (role === "camera") {
      setStatus("good", "Sending video", "Keep this page open.");
      return;
    }
    setStatus("good", "Direct WebRTC connected", "Verify the selected ICE path below.");
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
    await receiverVideo.pollPath(pc);
  }

  function sendSignal(message: SignalMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  async function updateLinks(): Promise<void> {
    await pairingLinks.update(room, mode, debug);
  }

  function toggleDebug(): void {
    if (!canDebug) {
      clearDebug();
      return;
    }
    debug = !debug;
    persistDebugInUrl(debug);
    updateLinks();
  }

  function setReceiverActive(active: boolean): void {
    receiverActive = active;
    if (!active) {
      clearDebug();
    }
  }

  function clearDebug(): void {
    if (!debug) {
      return;
    }
    debug = false;
    persistDebugInUrl(false);
    updateLinks();
  }

  function setStatus(kind: StatusKind, title: string, detail?: string): void {
    statusKind = kind;
    statusTitle = title;
    statusDetail = detail || "";
  }

  function setObsReceiverStatus(): void {
    setStatus("good", "OBS is handling the camera stream", "You can close this page.");
  }

  function fail(message: string, reason = "client_error"): void {
    sendSignal({ type: "client-failed", reason });
    setStatus("bad", "Failed", message);
    log(message);
  }

  function resetPeerConnection(): void {
    closePeerConnection();
    pendingCandidates = [];
    receiverVideo.clear();
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
    if (debug) {
      console.debug(`[webcam] ${message}`);
    }
  }

  function setRemoteVideo(node: HTMLVideoElement): void {
    receiverVideo.setVideo(node);
  }

  function setLocalVideo(node: HTMLVideoElement): void {
    localCamera.setVideo(node);
  }

  function startCameraFromUi(): void {
    startCamera().catch((error) => fail(errorMessage(error), "camera_permission"));
  }

  function switchCameraFromUi(): void {
    enableDeviceOrientation().catch((error) =>
      log(`Device orientation permission failed: ${errorMessage(error)}`),
    );
    switchCamera().catch((error) => fail(errorMessage(error), "camera_control"));
  }

  function toggleQualityFromUi(): void {
    enableDeviceOrientation().catch((error) =>
      log(`Device orientation permission failed: ${errorMessage(error)}`),
    );
    toggleQuality().catch((error) => fail(errorMessage(error), "camera_control"));
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
    get obsReceiverActive() {
      return obsReceiverActive;
    },
    get canDebug() {
      return canDebug;
    },
    get showDebug() {
      return showDebug;
    },
    get hasRemoteVideo() {
      return hasRemoteVideo;
    },
    get remoteVideoRotation() {
      return remoteVideoRotation;
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
    get browserWarning() {
      return browserWarning;
    },
    get cameraQr() {
      return pairingLinks.cameraQr;
    },
    get cameraUrl() {
      return pairingLinks.cameraUrl;
    },
    get obsUrl() {
      return pairingLinks.obsUrl;
    },
    get copyLabel() {
      return pairingLinks.copyLabel;
    },
    get copyDisabled() {
      return pairingLinks.copyDisabled;
    },
    get hasStream() {
      return localCamera.hasStream;
    },
    get cameraSummary() {
      return localCamera.summary;
    },
    get incomingSummary() {
      return receiverVideo.incomingSummary;
    },
    get pathSummary() {
      return receiverVideo.pathSummary;
    },
    get cameraFormat() {
      return localCamera.format;
    },
    get requestedFormat() {
      return localCamera.requestedFormat;
    },
    get qualityLabel() {
      return localCamera.qualityLabel;
    },
    get senderFormat() {
      return localCamera.senderFormat;
    },
    get trackState() {
      return localCamera.trackState;
    },
    get incomingFormat() {
      return receiverVideo.incomingFormat;
    },
    get inboundStats() {
      return receiverVideo.inboundStats;
    },
    get selectedPath() {
      return receiverVideo.selectedPath;
    },
    get relayState() {
      return receiverVideo.relayState;
    },
    get iceServersCount() {
      return 0;
    },
    mount,
    toggleDebug,
    copyObsUrl: pairingLinks.copyObsUrl,
    setRemoteVideo,
    setLocalVideo,
    startCameraFromUi,
    switchCameraFromUi,
    toggleQualityFromUi,
  };
}
