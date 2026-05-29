import type { Mode, Role, RoomResponse, SignalMessage } from "./types";

interface SignalingOptions {
  room: string;
  role: Role;
  mode: Mode;
  onOpen(clientMode: string): void;
  onMessage(message: SignalMessage): void;
  onClose(event: CloseEvent): void;
  onError(): void;
}

export async function createRoom(): Promise<string> {
  const response = await fetch("/api/rooms", { method: "POST", cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not create a pairing room.");
  }
  const data = (await response.json()) as RoomResponse;
  return data.room;
}

export function openSignaling(options: SignalingOptions): WebSocket {
  const clientMode =
    options.mode === "obs" ? "obs" : options.mode === "receiver" ? "preview" : "camera";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${scheme}://${location.host}/api/rooms/${options.room}/${options.role}?client=${clientMode}`,
  );

  ws.addEventListener("open", () => options.onOpen(clientMode));
  ws.addEventListener("message", (event: MessageEvent<string>) =>
    options.onMessage(JSON.parse(event.data) as SignalMessage),
  );
  ws.addEventListener("close", options.onClose);
  ws.addEventListener("error", options.onError);

  return ws;
}
