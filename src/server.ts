import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

type PlayerInfo = { id: string; name: string };
type Member = PlayerInfo & { socket: WebSocket; slot: number };
type Room = {
  code: string;
  hostId: string;
  acceptingJoins: boolean;
  nextPlayerNumber: number;
  members: Map<string, Member>;
};
type SocketMembership = { roomCode: string; playerId: string };

const MAX_PLAYERS = 4;
const CLOSED_CODE_TTL_MS = 15 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_ROOT = resolve(ROOT, "public");
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function cleanExpiredCodes(closedCodes: Map<string, number>): void {
  const now = Date.now();
  for (const [code, expiry] of closedCodes) {
    if (expiry <= now) closedCodes.delete(code);
  }
}

function makeRoomCode(rooms: Map<string, Room>, closedCodes: Map<string, number>): string {
  cleanExpiredCodes(closedCodes);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code) && !closedCodes.has(code)) return code;
  }
  throw new Error("Could not allocate a room code. Please try again.");
}

function publicError(code: string, message: string): Record<string, unknown> {
  return { type: "error", code, message };
}

function sanitizeSignal(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const signal = value as Record<string, unknown>;
  if (signal.kind === "description" && signal.description && typeof signal.description === "object" && !Array.isArray(signal.description)) {
    const description = signal.description as Record<string, unknown>;
    if ((description.type !== "offer" && description.type !== "answer") || typeof description.sdp !== "string") return null;
    return { kind: "description", description: { type: description.type, sdp: description.sdp } };
  }
  if (signal.kind === "candidate" && signal.candidate && typeof signal.candidate === "object" && !Array.isArray(signal.candidate)) {
    const candidate = signal.candidate as Record<string, unknown>;
    if (typeof candidate.candidate !== "string") return null;
    if (candidate.sdpMid != null && typeof candidate.sdpMid !== "string") return null;
    if (candidate.sdpMLineIndex != null && (typeof candidate.sdpMLineIndex !== "number" || !Number.isInteger(candidate.sdpMLineIndex))) return null;
    if (candidate.usernameFragment != null && typeof candidate.usernameFragment !== "string") return null;
    return { kind: "candidate", candidate: {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    } };
  }
  return null;
}

export function createGodhaServer() {
  const rooms = new Map<string, Room>();
  const closedCodes = new Map<string, number>();
  const membershipBySocket = new WeakMap<WebSocket, SocketMembership>();

  const httpServer = createHttpServer(async (request, response) => {
    await serveHttp(request, response);
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/signal") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object");
        message = parsed as Record<string, unknown>;
      } catch {
        send(socket, publicError("invalid-message", "The signaling message was not valid JSON."));
        return;
      }

      const currentMembership = membershipBySocket.get(socket);
      if (message.type === "create-room") {
        if (currentMembership) {
          send(socket, publicError("already-in-room", "Leave your current room before creating another."));
          return;
        }
        let code: string;
        try {
          code = makeRoomCode(rooms, closedCodes);
        } catch {
          send(socket, publicError("server-error", "A room could not be created. Please try again."));
          return;
        }
        const player: Member = { id: randomUUID(), name: "Player 1", socket, slot: 0 };
        const room: Room = {
          code,
          hostId: player.id,
          acceptingJoins: true,
          nextPlayerNumber: 2,
          members: new Map([[player.id, player]]),
        };
        rooms.set(code, room);
        membershipBySocket.set(socket, { roomCode: code, playerId: player.id });
        send(socket, {
          type: "room-created",
          roomCode: code,
          player: { id: player.id, name: player.name, slot: player.slot },
          hostId: room.hostId,
          acceptingJoins: room.acceptingJoins,
          peers: [],
        });
        return;
      }

      if (message.type === "join-room") {
        if (currentMembership) {
          send(socket, publicError("already-in-room", "Leave your current room before joining another."));
          return;
        }
        const code = typeof message.roomCode === "string" ? message.roomCode.trim().toUpperCase() : "";
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
          send(socket, publicError("invalid-room-code", "That room code is not valid. Check it and try again."));
          return;
        }
        cleanExpiredCodes(closedCodes);
        const room = rooms.get(code);
        if (!room) {
          if (closedCodes.has(code)) {
            send(socket, publicError("room-unavailable", "That room has closed and is no longer available."));
          } else {
            send(socket, publicError("invalid-room-code", "No room was found for that code."));
          }
          return;
        }
        if (!room.acceptingJoins) {
          send(socket, publicError("room-not-accepting", "This room is not accepting new players right now."));
          return;
        }
        if (room.members.size >= MAX_PLAYERS) {
          send(socket, publicError("room-full", `This room is full. The maximum is ${MAX_PLAYERS} players.`));
          return;
        }

        const existingPlayers: PlayerInfo[] = [...room.members.values()].map(({ id, name }) => ({ id, name }));
        const usedSlots = new Set([...room.members.values()].map((member) => member.slot));
        const slot = [0, 1, 2, 3].find((candidate) => !usedSlots.has(candidate))!;
        const player: Member = { id: randomUUID(), name: `Player ${room.nextPlayerNumber++}`, socket, slot };
        room.members.set(player.id, player);
        membershipBySocket.set(socket, { roomCode: code, playerId: player.id });
        send(socket, {
          type: "room-joined",
          roomCode: code,
          player: { id: player.id, name: player.name, slot: player.slot },
          hostId: room.hostId,
          acceptingJoins: room.acceptingJoins,
          peers: existingPlayers,
        });
        for (const existing of room.members.values()) {
          if (existing.id !== player.id) {
            send(existing.socket, { type: "peer-joined", player: { id: player.id, name: player.name } });
          }
        }
        return;
      }

      if (message.type === "leave-room") {
        if (!currentMembership) {
          send(socket, { type: "left-room" });
          return;
        }
        const room = rooms.get(currentMembership.roomCode);
        if (room) removeMember(room, currentMembership.playerId, socket, "left");
        membershipBySocket.delete(socket);
        send(socket, { type: "left-room" });
        return;
      }

      if (message.type === "set-accepting-joins") {
        if (!currentMembership) {
          send(socket, publicError("not-in-room", "Join a room before changing its settings."));
          return;
        }
        const room = rooms.get(currentMembership.roomCode);
        if (!room || room.hostId !== currentMembership.playerId) {
          send(socket, publicError("host-only", "Only the room host can change join settings."));
          return;
        }
        if (typeof message.accepting !== "boolean") {
          send(socket, publicError("invalid-message", "The join setting must be true or false."));
          return;
        }
        room.acceptingJoins = message.accepting;
        for (const member of room.members.values()) {
          send(member.socket, { type: "room-state", acceptingJoins: room.acceptingJoins });
        }
        send(socket, { type: "room-setting-updated", acceptingJoins: room.acceptingJoins });
        return;
      }

      if (message.type === "signal") {
        if (!currentMembership) {
          send(socket, publicError("not-in-room", "Join a room before sending connection setup."));
          return;
        }
        const room = rooms.get(currentMembership.roomCode);
        const targetId = typeof message.targetId === "string" ? message.targetId : "";
        const signal = sanitizeSignal(message.signal);
        if (!room || !targetId || targetId === currentMembership.playerId || !room.members.has(targetId)) {
          send(socket, publicError("peer-unavailable", "The other player is no longer available for setup."));
          return;
        }
        if (!signal) {
          send(socket, publicError("invalid-signal", "Only SDP offers/answers and ICE candidates can be relayed."));
          return;
        }
        send(room.members.get(targetId)!.socket, {
          type: "signal",
          fromId: currentMembership.playerId,
          signal,
        });
        return;
      }

      send(socket, publicError("unknown-message", "This signaling message type is not supported."));
    });

    socket.on("close", () => {
      const membership = membershipBySocket.get(socket);
      if (!membership) return;
      const room = rooms.get(membership.roomCode);
      if (room) removeMember(room, membership.playerId, socket, "disconnected");
      membershipBySocket.delete(socket);
    });
  });

  function removeMember(room: Room, playerId: string, socket: WebSocket, reason: "left" | "disconnected"): void {
    const member = room.members.get(playerId);
    if (!member || member.socket !== socket) return;
    room.members.delete(playerId);
    if (playerId === room.hostId || room.members.size === 0) {
      rooms.delete(room.code);
      closedCodes.set(room.code, Date.now() + CLOSED_CODE_TTL_MS);
      for (const remaining of room.members.values()) {
        membershipBySocket.delete(remaining.socket);
        send(remaining.socket, { type: "room-closed", message: "The room host left. This room is now closed." });
        remaining.socket.close(1000, "Room closed");
      }
      room.members.clear();
    } else {
      // Room registration cleanup, not a game-state or sync message.
      for (const remaining of room.members.values()) {
        send(remaining.socket, { type: "peer-left", playerId, reason });
      }
    }
  }

  async function serveHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, activeRooms: rooms.size }));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const relative = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const filePath = resolve(PUBLIC_ROOT, relative);
    if (!filePath.startsWith(PUBLIC_ROOT + sep)) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const contents = await readFile(filePath);
      response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  }

  return { httpServer, webSocketServer, get activeRoomCount() { return rooms.size; } };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT ?? 3000);
  const { httpServer } = createGodhaServer();
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`GODHA room server listening on http://localhost:${port}`);
  });
}
