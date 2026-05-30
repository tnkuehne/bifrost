import type { PhysicalOrientation } from "./types";

type DeviceOrientationCallbacks = {
  onOrientation: (orientation: PhysicalOrientation) => void;
  onLog: (message: string) => void;
};

type DeviceMotionPermission = {
  requestPermission?: () => Promise<PermissionState>;
};

const GRAVITY_THRESHOLD = 3;
const AXIS_DOMINANCE = 1.15;

export function createDeviceOrientation(callbacks: DeviceOrientationCallbacks) {
  let listening = false;
  let permission = "Waiting";
  let orientation: PhysicalOrientation = "unknown";

  async function start(): Promise<void> {
    if (listening) {
      return;
    }

    const motionEvent = globalThis.DeviceMotionEvent as
      | (typeof DeviceMotionEvent & DeviceMotionPermission)
      | undefined;
    if (!motionEvent) {
      permission = "Unsupported";
      callbacks.onLog("Device motion is not supported.");
      return;
    }

    const motionAllowed = await requestPermission(motionEvent, "Device motion", callbacks.onLog);
    if (!motionAllowed) {
      permission = "Denied";
      return;
    }

    globalThis.addEventListener("devicemotion", handleMotion);
    permission = "Granted";
    listening = true;
    callbacks.onLog("Device motion tracking enabled.");
  }

  function stop(): void {
    if (!listening) {
      return;
    }
    globalThis.removeEventListener("devicemotion", handleMotion);
    listening = false;
  }

  function handleMotion(event: DeviceMotionEvent): void {
    const next = classifyMotion(event);
    updateOrientation(next);
  }

  function updateOrientation(next: PhysicalOrientation): void {
    if (next === "unknown" || next === orientation) {
      return;
    }
    orientation = next;
    callbacks.onOrientation(next);
    callbacks.onLog(`Device orientation: ${next}.`);
  }

  return {
    get permission() {
      return permission;
    },
    get orientation() {
      return orientation;
    },
    start,
    stop,
  };
}

async function requestPermission(
  eventClass: (typeof DeviceMotionEvent & DeviceMotionPermission) | undefined,
  label: string,
  onLog: (message: string) => void,
): Promise<boolean> {
  if (!eventClass) {
    return false;
  }

  if (typeof eventClass.requestPermission !== "function") {
    return true;
  }

  const result = await eventClass.requestPermission();
  if (result !== "granted") {
    onLog(`${label} permission ${result}.`);
    return false;
  }
  return true;
}

function classifyMotion(event: DeviceMotionEvent): PhysicalOrientation {
  const gravity = event.accelerationIncludingGravity;
  if (!gravity || gravity.x === null || gravity.y === null) {
    return "unknown";
  }

  const absX = Math.abs(gravity.x);
  const absY = Math.abs(gravity.y);

  if (absX > GRAVITY_THRESHOLD && absX > absY * AXIS_DOMINANCE) {
    return gravity.x > 0 ? "landscape-left" : "landscape-right";
  }

  if (absY > GRAVITY_THRESHOLD && absY > absX * AXIS_DOMINANCE) {
    return "portrait";
  }

  return "unknown";
}
