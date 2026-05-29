import { els } from "./dom";
import { renderPairingQr } from "./qr";
import type { AppState, CameraSettingsMessage, Mode, StatusKind } from "./types";
import { errorMessage, round } from "./utils";

export function createUi(state: AppState, mode: Mode) {
  let copyResetTimer = 0;

  function renderCameraFormat(
    settings: CameraSettingsMessage | null | undefined,
    prefix: string,
  ): void {
    if (!settings) {
      els.cameraFormat.textContent = "Waiting";
      return;
    }
    const fps = settings.frameRate ? `${round(settings.frameRate)} fps` : "fps unknown";
    const size =
      settings.width && settings.height ? `${settings.width} x ${settings.height}` : "size unknown";
    els.cameraFormat.textContent = `${prefix}: ${size} at ${fps}`;
    els.cameraSummary.textContent = `${size} @ ${fps}`;
  }

  function updateLinks(): void {
    if (!state.room || mode === "camera") {
      return;
    }
    const cameraParams = new URLSearchParams({ room: state.room });
    if (state.debug) {
      cameraParams.set("debug", "1");
    }
    const cameraUrl = `${location.origin}/camera?${cameraParams}`;
    const obsUrl = `${location.origin}/obs?${new URLSearchParams({ room: state.room })}`;
    renderCameraQr(cameraUrl);
    els.cameraLink.textContent = cameraUrl;
    els.obsLink.textContent = obsUrl;
  }

  async function renderCameraQr(cameraUrl: string): Promise<void> {
    try {
      els.cameraQr.src = await renderPairingQr(cameraUrl);
    } catch (error) {
      fail(`QR generation failed: ${errorMessage(error)}`);
    }
  }

  function updateDebugMode(): void {
    const hidden = !state.debug || mode === "obs";
    document.body.classList.toggle("debug", state.debug && mode !== "obs");
    els.debugCameraPanel.classList.toggle("hidden", hidden);
    els.debugPathPanel.classList.toggle("hidden", hidden);
    els.debugEventsPanel.classList.toggle("hidden", hidden);
    els.cameraLink.classList.toggle("hidden", !state.debug || mode === "camera");
    els.obsLink.classList.toggle("hidden", !state.debug || mode === "camera");
    els.toggleDebug.textContent = state.debug ? "Normal" : "Debug";
    updatePageState();
  }

  function updatePageState(): void {
    const connected = state.pc?.connectionState === "connected";
    document.body.classList.toggle("connected", connected && mode !== "camera" && mode !== "obs");
    document.body.classList.toggle("pairing", !connected && mode !== "camera" && mode !== "obs");
  }

  function updateCameraControls(): void {
    if (mode !== "camera") {
      return;
    }
    els.startCamera.classList.toggle("hidden", Boolean(state.stream));
    els.switchCamera.classList.toggle("hidden", !state.stream);
  }

  async function copyText(text: string | null): Promise<void> {
    if (!text) {
      return;
    }
    els.copyObsLink.disabled = true;
    els.copyObsLink.textContent = "Copying...";
    try {
      await navigator.clipboard.writeText(text);
      els.copyObsLink.textContent = "Copied";
      log("Link copied.");
    } catch {
      els.copyObsLink.textContent = "Copy failed";
      log("Copy failed. Select the link text manually.");
    } finally {
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        els.copyObsLink.disabled = false;
        els.copyObsLink.textContent = "Copy OBS URL";
      }, 1200);
    }
  }

  function setStatus(kind: StatusKind, title: string, detail?: string): void {
    els.statusDot.className = `dot ${kind === "good" ? "good" : kind === "bad" ? "bad" : ""}`;
    els.statusText.textContent = title;
    els.statusDetail.textContent = detail || "";
    updatePageState();
  }

  function fail(message: string): void {
    setStatus("bad", "Failed", message);
    log(message);
  }

  function log(message: string): void {
    const line = document.createElement("div");
    line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    els.eventLog.insertBefore(line, els.eventLog.firstChild);
    while (els.eventLog.children.length > 8 && els.eventLog.lastElementChild) {
      els.eventLog.lastElementChild.remove();
    }
  }

  return {
    copyText,
    fail,
    log,
    renderCameraFormat,
    setStatus,
    updateCameraControls,
    updateDebugMode,
    updateLinks,
    updatePageState,
  };
}
