import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import {
  makeRoomId,
  readSignedRoomHandle,
  ROOM_HANDLE_PATTERN,
  ROOM_ID_PATTERN,
  signRoomId,
} from "./room-signing";

type Role = "receiver" | "camera";
type ClientMode = "camera" | "preview" | "obs";

interface ConnectionState {
  role: Role;
  clientMode: ClientMode;
  active: boolean;
  room: string;
  connectedAt: number;
  replacing?: boolean;
}

interface SignalEnvelope {
  type: string;
  [key: string]: unknown;
}

const ROLES = new Set<Role>(["receiver", "camera"]);
const MAX_SIGNAL_MESSAGE_LENGTH = 64 * 1024;
const MAX_ROOM_SOCKETS = 4;

function clientRateKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("cf-connecting-ip") || forwardedFor || "local";
}

async function rateLimit(limiter: RateLimit, key: string): Promise<Response | null> {
  const outcome = await limiter.limit({ key });
  return outcome.success
    ? null
    : new Response("Too many requests", {
        status: 429,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "retry-after": "60",
        },
      });
}

function isRole(value: string | null): value is Role {
  return value !== null && ROLES.has(value as Role);
}

function getState(ws: WebSocket): ConnectionState | null {
  return ws.deserializeAttachment() as ConnectionState | null;
}

function setState(ws: WebSocket, state: ConnectionState): void {
  ws.serializeAttachment(state);
}

export class SignalingRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const room = url.searchParams.get("room");
    if (!room || !ROOM_ID_PATTERN.test(room)) {
      return new Response("Invalid room", { status: 400 });
    }

    const role = url.searchParams.get("role");
    if (!isRole(role)) {
      return new Response("Invalid role", { status: 400 });
    }

    const clientMode = this.clientModeFor(role, url.searchParams.get("client"));
    const active = this.prepareForJoin(role, clientMode);
    if (this.connectedSocketCount() >= MAX_ROOM_SOCKETS) {
      return new Response("Room connection limit reached", { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    setState(server, {
      role,
      clientMode,
      active,
      room,
      connectedAt: Date.now(),
    });

    this.send(server, {
      type: "joined",
      role,
      clientMode,
      peers: this.connectedRoles(),
      ...(role === "receiver" ? { receiverActive: active } : {}),
    });
    if (active) {
      this.broadcast(server, {
        type: "peer-joined",
        role,
        clientMode,
        peers: this.connectedRoles(),
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = getState(ws);
    if (!state || typeof message !== "string") {
      return;
    }

    const rateLimitResponse = await rateLimit(this.env.SIGNAL_MESSAGE_RATE_LIMITER, state.room);
    if (rateLimitResponse) {
      this.send(ws, { type: "error", message: "Signaling rate limit exceeded" });
      ws.close(1013, "Signaling rate limit exceeded");
      return;
    }

    const currentState = getState(ws);
    if (!currentState || currentState.replacing) {
      return;
    }

    if (currentState.role === "receiver" && !currentState.active) {
      return;
    }

    if (message.length > MAX_SIGNAL_MESSAGE_LENGTH) {
      this.send(ws, { type: "error", message: "Signal message is too large" });
      ws.close(1009, "Signal message is too large");
      return;
    }

    let envelope: SignalEnvelope;
    try {
      envelope = JSON.parse(message) as SignalEnvelope;
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON signal" });
      return;
    }

    if (typeof envelope.type !== "string") {
      this.send(ws, { type: "error", message: "Signal is missing a type" });
      return;
    }

    this.forwardToPeer(ws, currentState.role, {
      ...envelope,
      from: currentState.role,
      receivedAt: Date.now(),
    });
  }

  override async webSocketClose(ws: WebSocket, _code: number, _reason: string): Promise<void> {
    const state = getState(ws);
    if (!state || state.replacing) {
      return;
    }

    if (state.role === "receiver" && state.active) {
      const promoted = this.promotePreviewReceiver(ws);
      this.broadcast(ws, {
        type: "peer-left",
        role: state.role,
        peers: this.connectedRoles(ws),
      });
      if (promoted) {
        this.broadcast(promoted, {
          type: "peer-joined",
          role: "receiver",
          clientMode: "preview",
          peers: this.connectedRoles(),
        });
      }
      return;
    }

    if (state.active) {
      this.broadcast(ws, {
        type: "peer-left",
        role: state.role,
        peers: this.connectedRoles(ws),
      });
    }
  }

  private clientModeFor(role: Role, value: string | null): ClientMode {
    if (role === "camera") {
      return "camera";
    }
    return value === "obs" ? "obs" : "preview";
  }

  private prepareForJoin(role: Role, clientMode: ClientMode): boolean {
    if (role === "camera") {
      for (const socket of this.ctx.getWebSockets()) {
        const state = getState(socket);
        if (state?.role === "camera") {
          this.replaceSocket(socket, "Replaced by a new camera connection");
        }
      }
      return true;
    }

    if (clientMode === "obs") {
      for (const socket of this.ctx.getWebSockets()) {
        const state = getState(socket);
        if (!state || state.role !== "receiver") {
          continue;
        }
        if (state.clientMode === "obs") {
          this.replaceSocket(socket, "Replaced by a new OBS receiver");
          continue;
        }
        if (state.active) {
          state.active = false;
          setState(socket, state);
          this.send(socket, {
            type: "receiver-deactivated",
            activeReceiver: "obs",
            peers: this.connectedRoles(),
          });
        } else if (state.clientMode === "preview") {
          this.replaceSocket(socket, "Replaced by a new OBS receiver");
        }
      }
      return true;
    }

    if (this.hasActiveObsReceiver()) {
      this.replaceInactivePreviewReceivers("Replaced by a new preview receiver");
      return false;
    }

    for (const socket of this.ctx.getWebSockets()) {
      const state = getState(socket);
      if (state?.role === "receiver" && state.clientMode === "preview") {
        this.replaceSocket(socket, "Replaced by a new preview receiver");
      }
    }
    return true;
  }

  private hasActiveObsReceiver(): boolean {
    for (const socket of this.ctx.getWebSockets()) {
      const state = getState(socket);
      if (state?.role === "receiver" && state.clientMode === "obs" && state.active) {
        return true;
      }
    }
    return false;
  }

  private replaceInactivePreviewReceivers(reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      const state = getState(socket);
      if (state?.role === "receiver" && state.clientMode === "preview" && !state.active) {
        this.replaceSocket(socket, reason);
      }
    }
  }

  private connectedSocketCount(): number {
    let count = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const state = getState(socket);
      if (state && !state.replacing) {
        count += 1;
      }
    }
    return count;
  }

  private promotePreviewReceiver(exclude: WebSocket): WebSocket | null {
    if (this.hasActiveObsReceiver()) {
      return null;
    }

    let newest: { socket: WebSocket; state: ConnectionState } | null = null;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) {
        continue;
      }
      const state = getState(socket);
      if (state?.role !== "receiver" || state.clientMode !== "preview") {
        continue;
      }
      if (!newest || state.connectedAt > newest.state.connectedAt) {
        newest = { socket, state };
      }
    }

    if (!newest) {
      return null;
    }

    newest.state.active = true;
    setState(newest.socket, newest.state);
    this.send(newest.socket, {
      type: "receiver-activated",
      peers: this.connectedRoles(),
    });
    return newest.socket;
  }

  private replaceSocket(socket: WebSocket, reason: string): void {
    const state = getState(socket);
    if (state) {
      state.replacing = true;
      setState(socket, state);
    }
    socket.close(4000, reason);
  }

  private connectedRoles(exclude?: WebSocket): Role[] {
    const roles = new Set<Role>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) {
        continue;
      }
      const state = getState(socket);
      if (state?.active) {
        roles.add(state.role);
      }
    }
    return Array.from(roles).sort();
  }

  private forwardToPeer(sender: WebSocket, from: Role, envelope: SignalEnvelope): void {
    const target: Role = from === "receiver" ? "camera" : "receiver";
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === sender) {
        continue;
      }
      const state = getState(socket);
      if (state?.role === target && state.active) {
        this.send(socket, envelope);
      }
    }
  }

  private broadcast(sender: WebSocket, envelope: SignalEnvelope): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== sender) {
        this.send(socket, envelope);
      }
    }
  }

  private send(ws: WebSocket, envelope: SignalEnvelope): void {
    try {
      ws.send(JSON.stringify(envelope));
    } catch {
      ws.close(1011, "Unable to send signal");
    }
  }
}

const app = new Hono<{ Bindings: Env }>();

app.post("/api/rooms", async (c) => {
  const rateLimitResponse = await rateLimit(c.env.ROOM_RATE_LIMITER, clientRateKey(c.req.raw));
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const url = new URL(c.req.url);
  let room: string;
  try {
    room = await signRoomId(makeRoomId(), c.env);
  } catch (error) {
    console.error(error);
    return c.text("Room signing is not configured", 500);
  }

  return c.json({
    room,
    receiverUrl: `${url.origin}/?room=${room}`,
    cameraUrl: `${url.origin}/camera?room=${room}`,
    obsUrl: `${url.origin}/obs?room=${room}`,
  });
});

app.get("/api/rooms/:room/:role", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  const roomHandle = c.req.param("room");
  const role = c.req.param("role");
  if (!ROOM_HANDLE_PATTERN.test(roomHandle) || !isRole(role)) {
    return c.text("Invalid signaling URL", 400);
  }

  const rateLimitResponse = await rateLimit(c.env.SIGNALING_RATE_LIMITER, clientRateKey(c.req.raw));
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let room: string | null;
  try {
    room = await readSignedRoomHandle(roomHandle, c.env);
  } catch (error) {
    console.error(error);
    return c.text("Room signing is not configured", 500);
  }
  if (!room) {
    return c.text("Invalid signaling URL", 403);
  }

  const id = c.env.SIGNALING_ROOM.idFromName(room);
  const stub = c.env.SIGNALING_ROOM.get(id);
  const roomUrl = new URL(c.req.url);
  roomUrl.searchParams.set("room", room);
  roomUrl.searchParams.set("role", role);
  return stub.fetch(new Request(roomUrl, c.req.raw));
});

app.all("/api/*", (c) => c.text("Not found", 404));

app.notFound((c) => c.text("Not found", 404));

export default app;
