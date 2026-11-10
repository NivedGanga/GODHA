export type PlayerStatus = "connecting" | "connected" | "disconnected";

export type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  status: PlayerStatus;
  isLocal: boolean;
};

export type NetworkEvent =
  | { type: "players"; players: Player[] }
  | { type: "status"; message: string; roomCode?: string }
  | { type: "error"; message: string }
  | { type: "room"; roomCode: string; isHost: boolean; acceptingJoins: boolean };

export type PeerDiagnostics = {
  playerId: string;
  name: string;
  connectionState: RTCPeerConnectionState;
  dataChannelState: RTCDataChannelState | "none";
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  bytesSent: number;
  bytesReceived: number;
};

type PlayerInfo = { id: string; name: string };
type ServerMessage = Record<string, unknown>;
type Peer = {
  id: string;
  name: string;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  pendingCandidates: RTCIceCandidateInit[];
  status: PlayerStatus;
  lastSeen: number;
  left: boolean;
};

type PendingRequest = {
  responseType: string;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // TURN can be added here later if restrictive networks require a relay.
];

const ERROR_MESSAGES: Record<string, string> = {
  "already-in-room": "Leave your current room before joining or creating another.",
  "host-only": "Only the room host can change this setting.",
  "invalid-room-code": "That room code is not valid. Check it and try again.",
  "peer-unavailable": "The other player is no longer available for connection setup.",
  "room-full": "This room is full. The maximum is 4 players.",
  "room-not-accepting": "This room is not accepting new players right now.",
  "room-unavailable": "That room has closed and is no longer available.",
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isPlayerInfo(value: unknown): value is PlayerInfo {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.name === "string";
}

export class GodhaNetwork {
  private socket: WebSocket | null = null;
  private socketPromise: Promise<WebSocket> | null = null;
  private pendingRequest: PendingRequest | null = null;
  private listeners = new Set<(event: NetworkEvent) => void>();
  private localPlayer: Player | null = null;
  private peers = new Map<string, Peer>();
  private players = new Map<string, Player>();
  private roomCode: string | null = null;
  private hostId: string | null = null;
  private acceptingJoins = true;
  private heartbeatTimer: number | null = null;
  private leaving = false;

  constructor(private readonly signalingUrl = GodhaNetwork.defaultSignalingUrl()) {}

  static defaultSignalingUrl(): string {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/signal`;
  }

  /** Subscribe to framework-independent network events; returns an unsubscribe function. */
  on(listener: (event: NetworkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPlayers(): Player[] {
    return [...this.players.values()]
      .map((player) => ({ ...player }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }

  isHost(): boolean {
    return Boolean(this.localPlayer && this.localPlayer.id === this.hostId);
  }

  isAcceptingJoins(): boolean {
    return this.acceptingJoins;
  }

  /** Snapshot the browser's WebRTC connection and selected-candidate-pair statistics. */
  async getPeerDiagnostics(): Promise<PeerDiagnostics[]> {
    return Promise.all([...this.peers.values()].map(async (peer) => {
      const stats = await peer.pc.getStats();
      const entries: Record<string, unknown>[] = [];
      stats.forEach((entry) => entries.push(entry as unknown as Record<string, unknown>));
      const transport = entries.find((entry) => entry.type === "transport" && typeof entry.selectedCandidatePairId === "string");
      const selectedId = transport?.selectedCandidatePairId;
      const pair = entries.find((entry) => entry.type === "candidate-pair" && entry.id === selectedId)
        ?? entries.find((entry) => entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated === true);
      const local = entries.find((entry) => entry.id === pair?.localCandidateId);
      const remote = entries.find((entry) => entry.id === pair?.remoteCandidateId);
      return {
        playerId: peer.id,
        name: peer.name,
        connectionState: peer.pc.connectionState,
        dataChannelState: peer.channel?.readyState ?? "none",
        localCandidateType: typeof local?.candidateType === "string" ? local.candidateType : null,
        remoteCandidateType: typeof remote?.candidateType === "string" ? remote.candidateType : null,
        bytesSent: typeof pair?.bytesSent === "number" ? pair.bytesSent : 0,
        bytesReceived: typeof pair?.bytesReceived === "number" ? pair.bytesReceived : 0,
      };
    }));
  }

  async createRoom(): Promise<string> {
    const response = await this.request("create-room", {}, "room-created");
    this.enterRoom(response, true);
    return this.roomCode!;
  }

  async joinRoom(code: string): Promise<string> {
    const response = await this.request("join-room", { roomCode: code.trim().toUpperCase() }, "room-joined");
    this.enterRoom(response, false);
    return this.roomCode!;
  }

  /** Set this client's 2D position in normalized room coordinates from 0 to 1. */
  updatePosition(x: number, y: number): void {
    if (!this.localPlayer) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.localPlayer.x = clamp(x);
    this.localPlayer.y = clamp(y);
    this.players.set(this.localPlayer.id, { ...this.localPlayer });
    this.broadcast({ type: "position", playerId: this.localPlayer.id, x: this.localPlayer.x, y: this.localPlayer.y });
    this.emit({ type: "players", players: this.getPlayers() });
  }

  async setAcceptingJoins(accepting: boolean): Promise<void> {
    const response = await this.request(
      "set-accepting-joins",
      { accepting },
      "room-setting-updated",
    );
    this.acceptingJoins = Boolean(response.acceptingJoins);
    this.emit({
      type: "status",
      message: this.acceptingJoins ? "Room is accepting joins." : "Room is locked; new players cannot join.",
      roomCode: this.roomCode ?? undefined,
    });
  }

  async leaveRoom(): Promise<void> {
    if (!this.localPlayer) {
      this.resetRoomState();
      return;
    }
    this.leaving = true;
    this.broadcast({ type: "presence", action: "left", playerId: this.localPlayer.id });
    // Give the direct peer channels a brief chance to flush the leave notice.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    try {
      await this.request("leave-room", {}, "left-room", 1800);
    } catch {
      // Local cleanup still succeeds when signaling has already disappeared.
    }
    this.resetRoomState();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "Left room");
    this.socket = null;
    this.socketPromise = null;
  }

  private enterRoom(message: ServerMessage, isHost: boolean): void {
    if (!isPlayerInfo(message.player) || typeof message.roomCode !== "string" || typeof message.hostId !== "string") {
      throw new Error("The room server returned an incomplete room setup response.");
    }
    this.roomCode = message.roomCode;
    this.hostId = message.hostId;
    this.acceptingJoins = Boolean(message.acceptingJoins);
    this.leaving = false;
    const assignedSlot = (message.player as PlayerInfo & { slot?: unknown }).slot;
    const slot = typeof assignedSlot === "number" && Number.isInteger(assignedSlot) && assignedSlot >= 0 && assignedSlot < 4 ? assignedSlot : 0;
    this.localPlayer = {
      id: message.player.id,
      name: message.player.name,
      x: slot % 2 === 0 ? 0.25 : 0.75,
      y: slot < 2 ? 0.3 : 0.7,
      status: "connected",
      isLocal: true,
    };
    this.players.set(this.localPlayer.id, { ...this.localPlayer });
    this.emit({ type: "room", roomCode: this.roomCode, isHost, acceptingJoins: this.acceptingJoins });
    this.emit({ type: "players", players: this.getPlayers() });
    this.emit({ type: "status", message: isHost ? "Room created. Share the code to invite others." : "Joined room. Connecting directly to players…", roomCode: this.roomCode });

    if (Array.isArray(message.peers)) {
      for (const info of message.peers) {
        if (isPlayerInfo(info)) this.addPeer(info);
      }
    }
    this.startHeartbeat();
  }

  private addPeer(info: PlayerInfo): void {
    if (!this.localPlayer || info.id === this.localPlayer.id || this.peers.has(info.id)) return;
    const peer: Peer = {
      id: info.id,
      name: info.name,
      pc: new RTCPeerConnection({ iceServers: ICE_SERVERS }),
      pendingCandidates: [],
      status: "connecting",
      lastSeen: Date.now(),
      left: false,
    };
    this.peers.set(peer.id, peer);
    this.players.set(peer.id, {
      id: peer.id,
      name: peer.name,
      x: 0.5,
      y: 0.5,
      status: "connecting",
      isLocal: false,
    });
    this.emit({ type: "players", players: this.getPlayers() });

    peer.pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(peer.id, { kind: "candidate", candidate: event.candidate.toJSON() });
    };
    peer.pc.onconnectionstatechange = () => {
      const state = peer.pc.connectionState;
      if (state === "connected") {
        if (peer.channel?.readyState === "open") this.setPeerStatus(peer, "connected");
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        this.setPeerStatus(peer, "disconnected");
      }
    };
    peer.pc.ondatachannel = (event) => this.configureDataChannel(peer, event.channel);

    // A single deterministic offerer per pair prevents glare and duplicate channels.
    if (this.localPlayer.id.localeCompare(peer.id) < 0) {
      this.configureDataChannel(peer, peer.pc.createDataChannel("godha-state", { ordered: true }));
      void this.createOffer(peer);
    }
  }

  private async createOffer(peer: Peer): Promise<void> {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal(peer.id, { kind: "description", description: peer.pc.localDescription?.toJSON() });
    } catch (error) {
      this.failPeer(peer, `Could not start a connection with ${peer.name}: ${this.errorText(error)}`);
    }
  }

  private configureDataChannel(peer: Peer, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onopen = () => {
      if (peer.left || this.leaving) return;
      peer.lastSeen = Date.now();
      this.setPeerStatus(peer, "connected");
      this.sendOnChannel(peer, {
        type: "hello",
        player: this.localPlayer ? { id: this.localPlayer.id, name: this.localPlayer.name, x: this.localPlayer.x, y: this.localPlayer.y } : null,
      });
      if (this.localPlayer) {
        this.sendOnChannel(peer, { type: "position", playerId: this.localPlayer.id, x: this.localPlayer.x, y: this.localPlayer.y });
      }
    };
    channel.onmessage = (event) => this.receivePeerMessage(peer, event.data);
    channel.onclose = () => {
      if (!peer.left && !this.leaving) this.setPeerStatus(peer, "disconnected");
    };
    channel.onerror = () => {
      if (!peer.left && !this.leaving) this.setPeerStatus(peer, "disconnected");
    };
  }

  private receivePeerMessage(peer: Peer, raw: unknown): void {
    if (peer.left) return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(String(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    peer.lastSeen = Date.now();
    if (message.type === "hello" && isPlayerInfo(message.player)) {
      if (message.player.id !== peer.id) return;
      peer.name = message.player.name;
      const initial = message.player as PlayerInfo & { x?: unknown; y?: unknown };
      const current = this.players.get(peer.id);
      this.players.set(peer.id, {
        id: peer.id,
        name: peer.name,
        x: typeof initial.x === "number" ? clamp(initial.x) : current?.x ?? 0.5,
        y: typeof initial.y === "number" ? clamp(initial.y) : current?.y ?? 0.5,
        status: "connected",
        isLocal: false,
      });
      this.setPeerStatus(peer, "connected");
    } else if (message.type === "position") {
      if (message.playerId !== peer.id || typeof message.x !== "number" || typeof message.y !== "number") return;
      const current = this.players.get(peer.id);
      if (!current) return;
      this.players.set(peer.id, { ...current, x: clamp(message.x), y: clamp(message.y), status: "connected" });
      this.setPeerStatus(peer, "connected");
      this.emit({ type: "players", players: this.getPlayers() });
    } else if (message.type === "presence" && message.action === "left" && message.playerId === peer.id) {
      this.removePeer(peer.id, "left");
    } else if (message.type === "ping") {
      this.sendOnChannel(peer, { type: "pong", at: message.at });
    } else if (message.type === "pong") {
      this.setPeerStatus(peer, "connected");
    }
  }

  private removePeer(peerId: string, reason: "left" | "disconnected"): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.left = true;
    try { peer.channel?.close(); } catch { /* already closed */ }
    try { peer.pc.close(); } catch { /* already closed */ }
    this.peers.delete(peerId);
    this.players.delete(peerId);
    this.emit({ type: "players", players: this.getPlayers() });
    this.emit({
      type: "status",
      message: reason === "left" ? `${peer.name} left the room.` : `${peer.name} disconnected.`,
      roomCode: this.roomCode ?? undefined,
    });
  }

  private setPeerStatus(peer: Peer, status: PlayerStatus): void {
    if (peer.left) return;
    peer.status = status;
    const player = this.players.get(peer.id);
    if (player) this.players.set(peer.id, { ...player, status });
    this.emit({ type: "players", players: this.getPlayers() });
  }

  private failPeer(peer: Peer, message: string): void {
    this.setPeerStatus(peer, "disconnected");
    this.emit({ type: "error", message });
  }

  private async handleSignal(fromId: string, signal: unknown): Promise<void> {
    if (!signal || typeof signal !== "object" || Array.isArray(signal)) return;
    const payload = signal as Record<string, unknown>;
    const peer = this.peers.get(fromId);
    if (!peer || peer.left) return;

    try {
      if (payload.kind === "description" && payload.description && typeof payload.description === "object") {
        const description = payload.description as RTCSessionDescriptionInit;
        await peer.pc.setRemoteDescription(description);
        await this.applyPendingCandidates(peer);
        if (description.type === "offer") {
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.sendSignal(peer.id, { kind: "description", description: peer.pc.localDescription?.toJSON() });
        }
      } else if (payload.kind === "candidate" && payload.candidate && typeof payload.candidate === "object") {
        const candidate = payload.candidate as RTCIceCandidateInit;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
        else peer.pendingCandidates.push(candidate);
      }
    } catch (error) {
      this.failPeer(peer, `Connection setup failed with ${peer.name}: ${this.errorText(error)}`);
    }
  }

  private async applyPendingCandidates(peer: Peer): Promise<void> {
    for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
  }

  private broadcast(message: Record<string, unknown>): void {
    for (const peer of this.peers.values()) this.sendOnChannel(peer, message);
  }

  private sendOnChannel(peer: Peer, message: Record<string, unknown>): void {
    if (peer.channel?.readyState !== "open") return;
    try {
      peer.channel.send(JSON.stringify(message));
    } catch {
      this.setPeerStatus(peer, "disconnected");
    }
  }

  private sendSignal(targetId: string, signal: Record<string, unknown>): void {
    if (!this.peers.has(targetId)) return;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.emit({ type: "error", message: "The signaling connection is unavailable; peer setup may fail." });
      return;
    }
    this.socket.send(JSON.stringify({ type: "signal", targetId, signal }));
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      const now = Date.now();
      for (const peer of this.peers.values()) {
        if (peer.left) continue;
        if (peer.channel?.readyState === "open") {
          this.sendOnChannel(peer, { type: "ping", at: now });
          if (now - peer.lastSeen > 45_000) this.setPeerStatus(peer, "disconnected");
        }
      }
    }, 10_000);
  }

  private request(type: string, data: Record<string, unknown>, responseType: string, timeoutMs = 8000): Promise<ServerMessage> {
    return this.openSocket().then((socket) => new Promise<ServerMessage>((resolve, reject) => {
      if (this.pendingRequest) {
        reject(new Error("Another room request is still in progress."));
        return;
      }
      const timeout = window.setTimeout(() => {
        this.pendingRequest = null;
        reject(new Error("The room server did not respond in time. Please try again."));
      }, timeoutMs);
      this.pendingRequest = { responseType, resolve, reject, timeout };
      try {
        socket.send(JSON.stringify({ type, ...data }));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pendingRequest = null;
        reject(new Error(this.errorText(error)));
      }
    }));
  }

  private openSocket(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.socketPromise) return this.socketPromise;
    this.socketPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.signalingUrl);
      let settled = false;
      const openTimeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Could not reach the room signaling server. Check that the prototype server is running."));
      }, 8000);
      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(openTimeout);
        this.socket = socket;
        resolve(socket);
      };
      socket.onmessage = (event) => this.handleServerMessage(event.data);
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(openTimeout);
          reject(new Error("Could not reach the room signaling server. Check that the prototype server is running."));
        }
      };
      socket.onclose = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(openTimeout);
          reject(new Error("The signaling connection closed before setup completed."));
        }
        if (this.socket === socket) {
          this.socket = null;
          if (!this.leaving && this.roomCode) {
            this.emit({ type: "status", message: "Signaling disconnected. Existing peer data channels may remain active.", roomCode: this.roomCode });
          }
        }
        if (this.socketPromise) this.socketPromise = null;
      };
    });
    return this.socketPromise;
  }

  private handleServerMessage(raw: unknown): void {
    let message: ServerMessage;
    try {
      const parsed: unknown = JSON.parse(String(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      message = parsed as ServerMessage;
    } catch {
      return;
    }

    if (message.type === "error") {
      const code = typeof message.code === "string" ? message.code : "";
      const error = new Error(ERROR_MESSAGES[code] ?? (typeof message.message === "string" ? message.message : "The room request failed."));
      if (this.pendingRequest) {
        window.clearTimeout(this.pendingRequest.timeout);
        const pending = this.pendingRequest;
        this.pendingRequest = null;
        pending.reject(error);
      } else {
        this.emit({ type: "error", message: error.message });
      }
      return;
    }

    if (this.pendingRequest && message.type === this.pendingRequest.responseType) {
      window.clearTimeout(this.pendingRequest.timeout);
      const pending = this.pendingRequest;
      this.pendingRequest = null;
      pending.resolve(message);
      return;
    }

    if (message.type === "peer-joined" && isPlayerInfo(message.player)) {
      this.addPeer(message.player);
    } else if (message.type === "peer-left" && typeof message.playerId === "string") {
      this.removePeer(message.playerId, message.reason === "left" ? "left" : "disconnected");
    } else if (message.type === "signal" && typeof message.fromId === "string") {
      void this.handleSignal(message.fromId, message.signal);
    } else if (message.type === "room-state") {
      this.acceptingJoins = Boolean(message.acceptingJoins);
      this.emit({
        type: "status",
        message: this.acceptingJoins ? "Room is accepting joins." : "Room is locked; new players cannot join.",
        roomCode: this.roomCode ?? undefined,
      });
    } else if (message.type === "room-closed") {
      this.emit({ type: "error", message: typeof message.message === "string" ? message.message : "The room has closed." });
      for (const peer of this.peers.values()) this.setPeerStatus(peer, "disconnected");
      this.resetRoomState();
    }
  }

  private resetRoomState(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const peer of this.peers.values()) {
      peer.left = true;
      try { peer.channel?.close(); } catch { /* already closed */ }
      try { peer.pc.close(); } catch { /* already closed */ }
    }
    this.peers.clear();
    this.players.clear();
    this.localPlayer = null;
    this.roomCode = null;
    this.hostId = null;
    this.acceptingJoins = true;
    this.leaving = false;
    this.emit({ type: "players", players: [] });
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private emit(event: NetworkEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
