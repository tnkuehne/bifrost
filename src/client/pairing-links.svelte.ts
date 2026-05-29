import { onCleanup, useDebounce } from "runed";
import { renderPairingQr } from "./qr";
import { buildPairingUrls } from "./session-url";
import type { Mode } from "./types";
import { errorMessage } from "./utils";

type PairingLinksCallbacks = {
  onError: (message: string) => void;
  onLog: (message: string) => void;
};

export function createPairingLinks(callbacks: PairingLinksCallbacks) {
  let cameraQr = $state("");
  let cameraUrl = $state("");
  let obsUrl = $state("");
  let copyLabel = $state("Copy OBS URL");
  let copyDisabled = $state(false);

  const resetCopyState = useDebounce(() => {
    copyDisabled = false;
    copyLabel = "Copy OBS URL";
  }, 1200);

  onCleanup(() => {
    resetCopyState.cancel();
  });

  async function update(room: string | null, mode: Mode, debug: boolean): Promise<void> {
    if (!room || mode === "camera") {
      return;
    }
    const urls = buildPairingUrls(room, debug);
    cameraUrl = urls.cameraUrl;
    obsUrl = urls.obsUrl;
    try {
      cameraQr = await renderPairingQr(cameraUrl);
    } catch (error) {
      callbacks.onError(`QR generation failed: ${errorMessage(error)}`);
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
      callbacks.onLog("Link copied.");
    } catch {
      copyLabel = "Copy failed";
      callbacks.onLog("Copy failed. Select the link text manually.");
    } finally {
      void resetCopyState();
    }
  }

  return {
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
    update,
    copyObsUrl,
  };
}
