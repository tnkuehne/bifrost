type TimingSafeSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
};

export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ROOM_HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;

const textEncoder = new TextEncoder();

export function makeRoomId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function signRoomId(roomId: string, env: Env): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(env),
    textEncoder.encode(roomId),
  );
  return `${roomId}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function readSignedRoomHandle(handle: string, env: Env): Promise<string | null> {
  if (!ROOM_HANDLE_PATTERN.test(handle)) {
    return null;
  }

  const [roomId, mac] = handle.split(".");
  if (!roomId || !mac || !ROOM_ID_PATTERN.test(roomId)) {
    return null;
  }

  const expected = await signRoomId(roomId, env);
  return timingSafeEqual(handle, expected) ? roomId : null;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signingKey(env: Env): Promise<CryptoKey> {
  if (!env.ROOM_SIGNING_SECRET) {
    throw new Error("ROOM_SIGNING_SECRET is not configured.");
  }
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.ROOM_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const lengthsMatch = leftBytes.byteLength === rightBytes.byteLength;
  const subtle = crypto.subtle as TimingSafeSubtleCrypto;
  return lengthsMatch
    ? subtle.timingSafeEqual(leftBytes, rightBytes)
    : !subtle.timingSafeEqual(leftBytes, leftBytes);
}
