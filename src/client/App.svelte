<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import CameraPanel from "./components/CameraPanel.svelte";
  import DebugPanels from "./components/DebugPanels.svelte";
  import ReceiverPanel from "./components/ReceiverPanel.svelte";
  import Stage from "./components/Stage.svelte";
  import StatusBlock from "./components/StatusBlock.svelte";
  import SummaryPanel from "./components/SummaryPanel.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import { createRoom as createSignalingRoom, openSignaling } from "./signaling";
  import type {
    CameraSettingsMessage,
    CandidatePairReport,
    CandidateReport,
    InboundVideoReport,
    Mode,
    Role,
    SignalMessage,
    StatsReport,
    StatusKind,
    TransportReport,
  } from "./types";
  import { errorMessage, isAllowedCandidate, round } from "./utils";
  import { renderPairingQr } from "./qr";

  const ICE_SERVERS: RTCIceServer[] = [];
  const ICE_CONFIG: RTCConfiguration = Object.freeze({
    iceServers: ICE_SERVERS,
    iceCandidatePoolSize: 0,
  });

  const urlParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const requestedMode = urlParams.get("mode") || hashParams.get("mode");
  const mode: Mode =
    requestedMode === "camera" || requestedMode === "obs" || requestedMode === "receiver"
      ? requestedMode
      : location.pathname.includes("camera")
        ? "camera"
        : location.pathname.includes("obs")
          ? "obs"
          : "receiver";
  const role: Role = mode === "camera" ? "camera" : "receiver";

  let remoteVideo: HTMLVideoElement | null = null;
  let localVideo: HTMLVideoElement | null = null;

  let room = getRoomFromUrl();
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let stream = $state<MediaStream | null>(null);
  let facingMode: "environment" | "user" = "environment";
  let pendingCandidates: RTCIceCandidateInit[] = [];
  let receiverActive = mode === "obs";
  let statsTimer = 0;
  let incomingFrames = 0;
  let lastIncomingAt = 0;
  let lastFrameSampleAt = 0;
  let orientationTimer = 0;
  let debug = $state(urlParams.get("debug") === "1" || hashParams.get("debug") === "1");
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

  const title = mode === "camera" ? "Camera" : mode === "obs" ? "OBS Receiver" : "Receiver";
  let pairing = $derived(!hasRemoteVideo && mode !== "camera" && mode !== "obs");
  let showDebug = $derived(debug && mode !== "obs");
  let appClass = $derived(getAppClass(mode, debug));
  let panelClass = $derived(getPanelClass(mode, debug, hasRemoteVideo));

  onMount(() => {
    init().catch((error: unknown) => fail(errorMessage(error)));

    return () => {
      closePeerConnection();
      ws?.close();
      stream?.getTracks().forEach((track) => track.stop());
      window.clearTimeout(orientationTimer);
      window.clearTimeout(copyResetTimer);
    };
  });

  async function init(): Promise<void> {
    if (remoteVideo) {
      remoteVideo.autoplay = true;
      remoteVideo.muted = true;
      remoteVideo.playsInline = true;
    }

    for (const eventName of ["pointerdown", "touchend", "keydown"]) {
      document.addEventListener(eventName, () => tryPlayRemoteVideo("user interaction"), {
        once: true,
      });
    }

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

  async function createRoom(): Promise<void> {
    room = await createSignalingRoom();
    location.hash = `room=${room}`;
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

    const peer = new RTCPeerConnection(ICE_CONFIG);
    pc = peer;

    peer.addEventListener("icecandidate", (event) => {
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

    peer.addEventListener("track", (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream || !remoteVideo) {
        fail("Remote video track arrived without a media stream.");
        return;
      }
      remoteVideo.srcObject = remoteStream;
      hasRemoteVideo = true;
      tryPlayRemoteVideo("track received");
      setStatus("good", "Video connected", "OBS can capture this receiver page.");
      trackIncomingVideo();
      startStatsPolling();
    });

    peer.addEventListener("connectionstatechange", () => {
      log(`Peer connection: ${peer.connectionState}`);
      if (peer.connectionState === "connected") {
        setStatus("good", "Direct WebRTC connected", "Verify the selected ICE path below.");
        startStatsPolling();
      }
      if (["failed", "closed"].includes(peer.connectionState)) {
        fail("Direct WebRTC connection failed. No relay fallback is configured.");
      }
    });

    peer.addEventListener("iceconnectionstatechange", () => {
      log(`ICE: ${peer.iceConnectionState}`);
      if (peer.iceConnectionState === "failed") {
        fail(
          "ICE failed locally. Check that both devices are on the same LAN or USB-tethered network.",
        );
      }
    });

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
    if (!candidate || !isAllowedCandidate(candidate.candidate || "")) {
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

    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30 },
      },
    });
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

  function watchCameraOrientation(): void {
    const scheduleRefresh = () => {
      if (!stream) {
        return;
      }
      window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(() => {
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
      senderFormat = `balanced adaptive, ${Math.round(maxBitrate / 1_000_000)} Mbps cap`;
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
    const [track] = stream?.getVideoTracks() || [];
    if (!track) {
      trackState = "No track";
      return null;
    }
    const settings = track.getSettings();
    trackState = `${track.readyState}, ${settings.facingMode || "unknown"} camera`;
    return {
      width: settings.width || null,
      height: settings.height || null,
      frameRate: settings.frameRate || null,
      facingMode: settings.facingMode || null,
    };
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

  function trackIncomingVideo(): void {
    if (!remoteVideo) {
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
      incomingFrames += 1;
      if (!lastIncomingAt) {
        lastIncomingAt = now;
      }
      if (now - lastIncomingAt > 1000) {
        const fps = (incomingFrames * 1000) / (now - lastIncomingAt);
        incomingFrames = 0;
        lastIncomingAt = now;
        updateIncomingFormat(fps);
        updateVideoElementState();
        sampleRemoteFrame(now);
      }
      remoteVideo?.requestVideoFrameCallback(onFrame);
    };
    remoteVideo.requestVideoFrameCallback(onFrame);
  }

  function updateIncomingFormat(fps?: number): void {
    const size =
      remoteVideo?.videoWidth && remoteVideo.videoHeight
        ? `${remoteVideo.videoWidth} x ${remoteVideo.videoHeight}`
        : "size unknown";
    incomingFormat = fps ? `${size} at ${round(fps)} fps measured` : size;
    incomingSummary = fps ? `${size} @ ${round(fps)} fps` : size;
  }

  function tryPlayRemoteVideo(reason: string): void {
    if (!remoteVideo?.srcObject) {
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
        videoElementState = "play blocked; click receiver page once";
      });
  }

  function updateVideoElementState(): void {
    if (!remoteVideo) {
      videoElementState = "Waiting";
      return;
    }
    const states = ["empty", "metadata", "current data", "future data", "enough data"];
    const ready = states[remoteVideo.readyState] || String(remoteVideo.readyState);
    const size =
      remoteVideo.clientWidth && remoteVideo.clientHeight
        ? `${remoteVideo.clientWidth} x ${remoteVideo.clientHeight} CSS`
        : "no layout box";
    videoElementState = `${ready}, ${remoteVideo.paused ? "paused" : "playing"}, ${size}`;
  }

  function sampleRemoteFrame(now = performance.now()): void {
    if (now - lastFrameSampleAt < 1000 || !remoteVideo?.videoWidth || !remoteVideo.videoHeight) {
      return;
    }
    lastFrameSampleAt = now;

    const canvas = document.createElement("canvas");
    const width = 32;
    const height = 32;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      frameSample = "Canvas unavailable";
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
      frameSample = `${verdict}, luma ${round(luma)}, rgb ${round(red)}/${round(green)}/${round(
        blue,
      )}`;
    } catch (error) {
      frameSample = `Canvas sample failed: ${errorMessage(error)}`;
    }
  }

  function startStatsPolling(): void {
    if (statsTimer) {
      return;
    }
    statsTimer = window.setInterval(pollSelectedPath, 1200);
    pollSelectedPath();
  }

  async function pollSelectedPath(): Promise<void> {
    if (!pc) {
      return;
    }
    const stats = await pc.getStats();
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
      const width = inboundVideo.frameWidth || remoteVideo?.videoWidth || "?";
      const height = inboundVideo.frameHeight || remoteVideo?.videoHeight || "?";
      const fps = inboundVideo.framesPerSecond
        ? `${round(inboundVideo.framesPerSecond)} fps`
        : "fps hidden";
      const decoded = inboundVideo.framesDecoded ?? "?";
      const dropped = inboundVideo.framesDropped ?? "?";
      const freezes = inboundVideo.freezeCount ?? 0;
      inboundStats = `${width} x ${height}, ${fps}, decoded ${decoded}, dropped ${dropped}, freezes ${freezes}`;
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

    selectedPath = direct
      ? "Direct non-relay ICE candidate pair selected"
      : "Selected path needs review";
    pathSummary = direct ? "Local direct" : "Needs review";
    localCandidate = localText;
    remoteCandidate = remoteText;
    relayState = relay ? "Relay detected - connection closed" : "No relay candidate selected";

    if (relay) {
      fail("A relay candidate was selected. Closing instead of carrying media through a relay.");
      closePeerConnection();
    }
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

  function sendSignal(message: SignalMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  async function updateLinks(): Promise<void> {
    if (!room || mode === "camera") {
      return;
    }
    const cameraParams = new URLSearchParams({ room });
    if (debug) {
      cameraParams.set("debug", "1");
    }
    cameraUrl = `${location.origin}/camera?${cameraParams}`;
    obsUrl = `${location.origin}/obs?${new URLSearchParams({ room })}`;
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
    const nextUrl = new URL(location.href);
    if (debug) {
      nextUrl.searchParams.set("debug", "1");
    } else {
      nextUrl.searchParams.delete("debug");
    }
    history.replaceState(null, "", nextUrl);
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
    if (remoteVideo) {
      remoteVideo.srcObject = null;
    }
    hasRemoteVideo = false;
  }

  function closePeerConnection(): void {
    if (pc) {
      pc.close();
      pc = null;
    }
    if (statsTimer) {
      window.clearInterval(statsTimer);
      statsTimer = 0;
    }
    hasRemoteVideo = false;
  }

  function log(message: string): void {
    events = [`${new Date().toLocaleTimeString()} ${message}`, ...events].slice(0, 8);
  }

  function getRoomFromUrl(): string | null {
    if (urlParams.has("room")) {
      return urlParams.get("room");
    }
    return hashParams.get("room");
  }

  function getAppClass(currentMode: Mode, showDebug: boolean): string {
    if (currentMode === "obs") {
      return "block min-h-screen overflow-hidden bg-black text-text";
    }
    if (showDebug) {
      return "grid min-h-screen grid-cols-[minmax(0,1fr)_390px] bg-bg text-text max-[900px]:grid-cols-1";
    }
    if (currentMode === "camera") {
      return "flex min-h-screen flex-col items-center justify-center gap-[18px] bg-bg px-[18px] pt-[max(22px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] text-text";
    }
    return "grid min-h-screen place-items-center bg-bg text-text";
  }

  function getPanelClass(
    currentMode: Mode,
    showDebug: boolean,
    remoteVideoVisible: boolean,
  ): string {
    if (showDebug) {
      return "min-h-screen overflow-auto border-l border-line bg-panel p-[22px] max-[900px]:min-h-0 max-[900px]:border-t max-[900px]:border-l-0";
    }
    if (currentMode === "camera") {
      return "order-1 min-h-0 w-[min(100%,390px)] overflow-visible bg-transparent p-0";
    }
    if (remoteVideoVisible) {
      return "fixed right-4 bottom-4 max-h-[calc(100vh-32px)] w-[min(420px,calc(100vw-32px))] overflow-auto rounded-lg border border-line bg-panel/88 p-[22px] shadow-panel backdrop-blur-[10px]";
    }
    return "mx-auto min-h-0 w-[min(100%,390px)] overflow-visible bg-transparent px-[22px] py-[34px]";
  }

  function setRemoteVideo(node: HTMLVideoElement): void {
    remoteVideo = node;
    remoteVideo.autoplay = true;
    remoteVideo.muted = true;
    remoteVideo.playsInline = true;
  }

  function setLocalVideo(node: HTMLVideoElement): void {
    localVideo = node;
    if (stream) {
      localVideo.srcObject = stream;
    }
  }
</script>

<svelte:head>
  <title>Local WebRTC Webcam</title>
</svelte:head>

<main class={appClass}>
  <Stage {mode} {debug} {pairing} {setRemoteVideo} {setLocalVideo} />

  {#if mode !== "obs"}
    <aside class={panelClass}>
      <div class="grid gap-3">
        <Toolbar {title} {debug} compact={!debug} onToggleDebug={toggleDebug} />
        <StatusBlock kind={statusKind} title={statusTitle} detail={statusDetail} compact={!debug} />
      </div>

      {#if mode !== "camera"}
        <ReceiverPanel
          {debug}
          {cameraQr}
          {cameraUrl}
          {obsUrl}
          {copyLabel}
          {copyDisabled}
          onCopyObsUrl={copyObsUrl}
        />
      {/if}

      {#if mode === "camera"}
        <CameraPanel
          compact={!debug}
          hasStream={Boolean(stream)}
          onStartCamera={() => startCamera().catch((error) => fail(errorMessage(error)))}
          onSwitchCamera={() => switchCamera().catch((error) => fail(errorMessage(error)))}
        />
      {/if}

      {#if mode !== "camera" && debug}
        <SummaryPanel {cameraSummary} {incomingSummary} {pathSummary} />
      {/if}

      {#if showDebug}
        <DebugPanels
          {mode}
          {role}
          iceServersCount={ICE_SERVERS.length}
          {cameraFormat}
          {senderFormat}
          {trackState}
          {incomingFormat}
          {videoElementState}
          {frameSample}
          {inboundStats}
          {selectedPath}
          {localCandidate}
          {remoteCandidate}
          {relayState}
          {events}
        />
      {/if}
    </aside>
  {/if}
</main>
