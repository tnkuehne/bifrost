import { DurableObject } from "cloudflare:workers";
import QRCode from "qrcode";

type Role = "receiver" | "camera";

interface ConnectionState {
	role: Role;
	connectedAt: number;
}

interface SignalEnvelope {
	type: string;
	[key: string]: unknown;
}

const ROOM_PATTERN = /^[a-z0-9-]{6,64}$/;
const ROLES = new Set<Role>(["receiver", "camera"]);

function json(data: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...init.headers,
		},
	});
}

async function serveApp(request: Request, env: Env): Promise<Response> {
	const response = await env.ASSETS.fetch(new Request(`${new URL(request.url).origin}/index.html`, request));
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function makeRoomId(): string {
	const bytes = new Uint8Array(10);
	crypto.getRandomValues(bytes);
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
	return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function isRole(value: string | null): value is Role {
	return value !== null && ROLES.has(value as Role);
}

function getState(ws: WebSocket): ConnectionState | null {
	return ws.deserializeAttachment() as ConnectionState | null;
}

export class SignalingRoom extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const url = new URL(request.url);
		const role = url.searchParams.get("role");
		if (!isRole(role)) {
			return new Response("Invalid role", { status: 400 });
		}

		for (const socket of this.ctx.getWebSockets()) {
			const state = getState(socket);
			if (state?.role === role) {
				socket.close(4000, "Replaced by a new connection for this role");
			}
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ role, connectedAt: Date.now() } satisfies ConnectionState);

		this.send(server, {
			type: "joined",
			role,
			peers: this.connectedRoles(),
		});
		this.broadcast(server, {
			type: "peer-joined",
			role,
			peers: this.connectedRoles(),
		});

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const state = getState(ws);
		if (!state || typeof message !== "string") {
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

		this.forwardToPeer(state.role, {
			...envelope,
			from: state.role,
			receivedAt: Date.now(),
		});
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		const state = getState(ws);
		if (state) {
			this.broadcast(ws, {
				type: "peer-left",
				role: state.role,
				peers: this.connectedRoles(ws),
			});
		}
	}

	private connectedRoles(exclude?: WebSocket): Role[] {
		const roles = new Set<Role>();
		for (const socket of this.ctx.getWebSockets()) {
			if (socket === exclude) {
				continue;
			}
			const state = getState(socket);
			if (state) {
				roles.add(state.role);
			}
		}
		return Array.from(roles).sort();
	}

	private forwardToPeer(from: Role, envelope: SignalEnvelope): void {
		const target: Role = from === "receiver" ? "camera" : "receiver";
		for (const socket of this.ctx.getWebSockets()) {
			const state = getState(socket);
			if (state?.role === target) {
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

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/room") {
			const room = makeRoomId();
			return json({
				room,
				receiverUrl: `${url.origin}/receiver?mode=receiver&room=${room}`,
				cameraUrl: `${url.origin}/camera?mode=camera&room=${room}`,
				obsUrl: `${url.origin}/obs?mode=obs&room=${room}`,
			});
		}

		if (url.pathname === "/api/qr") {
			const data = url.searchParams.get("data");
			if (!data || data.length > 512) {
				return new Response("Invalid QR data", { status: 400 });
			}

			const svg = await QRCode.toString(data, {
				type: "svg",
				errorCorrectionLevel: "M",
				margin: 2,
				color: {
					dark: "#07100d",
					light: "#ffffff",
				},
			});
			return new Response(svg, {
				headers: {
					"cache-control": "no-store",
					"content-type": "image/svg+xml; charset=utf-8",
				},
			});
		}

		if (url.pathname.startsWith("/ws/")) {
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected WebSocket upgrade", { status: 426 });
			}

			const [, , room, role] = url.pathname.split("/");
			if (!ROOM_PATTERN.test(room ?? "") || !isRole(role ?? null)) {
				return new Response("Invalid signaling URL", { status: 400 });
			}

			const id = env.SIGNALING_ROOM.idFromName(room);
			const stub = env.SIGNALING_ROOM.get(id);
			const roomUrl = new URL(request.url);
			roomUrl.searchParams.set("role", role);
			return stub.fetch(new Request(roomUrl, request));
		}

		if (["/", "/receiver", "/camera", "/obs"].includes(url.pathname)) {
			return serveApp(request, env);
		}

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
