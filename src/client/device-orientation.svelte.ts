import type { PhysicalOrientation } from "./types";

type DeviceOrientationCallbacks = {
  onOrientation: (orientation: PhysicalOrientation) => void;
  onLog: (message: string) => void;
};

type DeviceOrientationPermission = {
  requestPermission?: () => Promise<PermissionState>;
};

type DeviceMotionPermission = {
  requestPermission?: () => Promise<PermissionState>;
};

const MOTION_FALLBACK_MS = 1500;
const GRAVITY_THRESHOLD = 3;
const AXIS_DOMINANCE = 1.15;

export function createDeviceOrientation(callbacks: DeviceOrientationCallbacks) {
  let listening = false;
  let permission = $state("Waiting");
  let orientation = $state<PhysicalOrientation>("unknown");
  let motionPreferredUntil = 0;

  async function start(): Promise<void> {
    if (listening) {
      return;
    }

    const orientationEvent = globalThis.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & DeviceOrientationPermission)
      | undefined;
    const motionEvent = globalThis.DeviceMotionEvent as
      | (typeof DeviceMotionEvent & DeviceMotionPermission)
      | undefined;
    if (!orientationEvent && !motionEvent) {
      permission = "Unsupported";
      callbacks.onLog("Device orientation and motion are not supported.");
      return;
    }

    const motionAllowed = await requestPermission(motionEvent, "Device motion", callbacks.onLog);
    const orientationAllowed = await requestPermission(
      orientationEvent,
      "Device orientation",
      callbacks.onLog,
    );

    if (!motionAllowed && !orientationAllowed) {
      permission = "Denied";
      return;
    }

    if (motionAllowed) {
      globalThis.addEventListener("devicemotion", handleMotion);
    }
    if (orientationAllowed) {
      globalThis.addEventListener("deviceorientation", handleOrientation);
    }

    permission = "Granted";
    listening = true;
    callbacks.onLog("Device orientation tracking enabled with gravity-vector preference.");
  }

  function stop(): void {
    if (!listening) {
      return;
    }
    globalThis.removeEventListener("devicemotion", handleMotion);
    globalThis.removeEventListener("deviceorientation", handleOrientation);
    listening = false;
  }

  function handleMotion(event: DeviceMotionEvent): void {
    const next = classifyMotion(event);
    if (next === "unknown") {
      return;
    }
    motionPreferredUntil = Date.now() + MOTION_FALLBACK_MS;
    updateOrientation(next);
  }

  function handleOrientation(event: DeviceOrientationEvent): void {
    if (Date.now() < motionPreferredUntil) {
      return;
    }
    const next = classifyOrientation(event);
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
  eventClass:
    | (typeof DeviceOrientationEvent & DeviceOrientationPermission)
    | (typeof DeviceMotionEvent & DeviceMotionPermission)
    | undefined,
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

function classifyOrientation(event: DeviceOrientationEvent): PhysicalOrientation {
  if (event.gamma === null || event.beta === null) {
    return "unknown";
  }

  if (Math.abs(event.gamma) > 45) {
    return event.gamma > 0 ? "landscape-right" : "landscape-left";
  }

  if (Math.abs(event.beta) > 45) {
    return "portrait";
  }

  return "unknown";
}
