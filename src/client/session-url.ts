import type { Mode, Role } from "./types";

export type SessionRoute = {
  mode: Mode;
  role: Role;
  room: string | null;
  debug: boolean;
};

export type PairingUrls = {
  cameraUrl: string;
  obsUrl: string;
};

export function readSessionRoute(location: Location): SessionRoute {
  const urlParams = new URLSearchParams(location.search);
  const requestedMode = urlParams.get("mode");
  const mode: Mode =
    requestedMode === "camera" || requestedMode === "obs" || requestedMode === "receiver"
      ? requestedMode
      : location.pathname.includes("camera")
        ? "camera"
        : location.pathname.includes("obs")
          ? "obs"
          : "receiver";

  return {
    mode,
    role: mode === "camera" ? "camera" : "receiver",
    room: urlParams.get("room"),
    debug: urlParams.get("debug") === "1",
  };
}

export function persistRoomInUrl(room: string): void {
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set("room", room);
  history.replaceState(null, "", nextUrl);
}

export function buildPairingUrls(room: string, debug: boolean): PairingUrls {
  const cameraParams = new URLSearchParams({ room });
  if (debug) {
    cameraParams.set("debug", "1");
  }

  return {
    cameraUrl: `${location.origin}/camera?${cameraParams}`,
    obsUrl: `${location.origin}/obs?${new URLSearchParams({ room })}`,
  };
}

export function persistDebugInUrl(debug: boolean): void {
  const nextUrl = new URL(location.href);
  if (debug) {
    nextUrl.searchParams.set("debug", "1");
  } else {
    nextUrl.searchParams.delete("debug");
  }
  history.replaceState(null, "", nextUrl);
}
