export const MAX_PLAYERS = 6;
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
export const MAP_NAME = "Sunny Meadow";

export type TeamId = "red" | "blue" | "yellow" | "green";

export interface TeamDefinition {
  id: TeamId;
  label: string;
  color: string;
}

export const TEAMS: readonly TeamDefinition[] = [
  { id: "red", label: "Red", color: "#e85b3c" },
  { id: "blue", label: "Blue", color: "#4b91df" },
  { id: "yellow", label: "Yellow", color: "#f4b528" },
  { id: "green", label: "Green", color: "#7dbd37" },
] as const;

export interface RoomPlayer {
  id: string;
  name: string;
  team: TeamId;
  isHost: boolean;
  isCurrentPlayer: boolean;
  ready: boolean;
}

export interface Room {
  code: string;
  map: typeof MAP_NAME;
  players: RoomPlayer[];
}

export type RoomErrorCode =
  | "NAME_REQUIRED"
  | "INVALID_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_MISSING"
  | "PLAYER_MISSING"
  | "HOST_READINESS";

export class RoomServiceError extends Error {
  constructor(public readonly code: RoomErrorCode, message: string) {
    super(message);
    this.name = "RoomServiceError";
  }
}

/**
 * Small contract for the UI to use now and for a later network-backed adapter.
 * This Sprint 2 implementation is local-only and never opens a WebSocket or
 * constructs an RTCPeerConnection.
 */
export interface RoomService {
  createRoom(playerName: string): Room;
  joinRoom(playerName: string, code: string): Room;
  addSimulatedGuest(code: string): Room;
  setReady(code: string, playerId: string, ready: boolean): Room;
  getRoom(code: string): Room | null;
  getFixtureRoom(code: string): Room | null;
  leaveRoom(code: string, playerId: string): void;
}

interface RoomRecord {
  room: Room;
  fixture: boolean;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEMO_GUEST_NAMES = ["Pip", "Mochi", "Boba", "Nori", "Clover"];

function cloneRoom(room: Room): Room {
  return { ...room, players: room.players.map((player) => ({ ...player })) };
}

function validateName(playerName: string): string {
  const name = playerName.trim();
  if (!name) {
    throw new RoomServiceError("NAME_REQUIRED", "Enter a player name first.");
  }
  return name.slice(0, 24);
}

function firstOpenTeam(players: readonly RoomPlayer[]): TeamId {
  const team = TEAMS.find(
    (candidate) => players.filter((player) => player.team === candidate.id).length < 2,
  );
  if (!team) {
    throw new RoomServiceError("ROOM_FULL", "This room already has six players.");
  }
  return team.id;
}

function canFitAnotherPlayer(room: Room): boolean {
  return room.players.length < MAX_PLAYERS && room.players.some((player) => {
    return room.players.filter((candidate) => candidate.team === player.team).length < 2;
  }) || (room.players.length < MAX_PLAYERS && TEAMS.some((team) => {
    return room.players.filter((player) => player.team === team.id).length < 2;
  }));
}

export function canStartRoom(room: Room): boolean {
  const guests = room.players.filter((player) => !player.isHost);
  return room.players.some((player) => player.isHost)
    && guests.length >= 1
    && guests.every((player) => player.ready);
}

export class SimulatedRoomService implements RoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private nextPlayerId = 1;
  private nextDemoGuest = 0;

  constructor() {
    this.seedFixtures();
  }

  createRoom(playerName: string): Room {
    const name = validateName(playerName);
    let code = "";
    do {
      code = this.makeCode();
    } while (this.rooms.has(code));

    const room: Room = {
      code,
      map: MAP_NAME,
      players: [{
        id: this.makePlayerId(),
        name,
        team: "red",
        isHost: true,
        isCurrentPlayer: true,
        ready: true,
      }],
    };
    this.rooms.set(code, { room, fixture: false });
    return cloneRoom(room);
  }

  joinRoom(playerName: string, rawCode: string): Room {
    const name = validateName(playerName);
    const code = rawCode.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
      throw new RoomServiceError("INVALID_CODE", "Enter a six-character room code.");
    }

    const record = this.rooms.get(code);
    if (!record) {
      throw new RoomServiceError("ROOM_NOT_FOUND", "We couldn't find that room. Check the code and try again.");
    }
    if (!canFitAnotherPlayer(record.room)) {
      throw new RoomServiceError("ROOM_FULL", "That room is full (6 of 6 players). Try another code.");
    }

    record.room.players.push({
      id: this.makePlayerId(),
      name,
      team: firstOpenTeam(record.room.players),
      isHost: false,
      isCurrentPlayer: true,
      ready: false,
    });
    return cloneRoom(record.room);
  }

  addSimulatedGuest(code: string): Room {
    const record = this.requireRoom(code);
    if (!canFitAnotherPlayer(record.room)) {
      throw new RoomServiceError("ROOM_FULL", "This room is already at the six-player limit.");
    }
    const name = DEMO_GUEST_NAMES[this.nextDemoGuest % DEMO_GUEST_NAMES.length];
    this.nextDemoGuest += 1;
    record.room.players.push({
      id: this.makePlayerId(),
      name,
      team: firstOpenTeam(record.room.players),
      isHost: false,
      isCurrentPlayer: false,
      ready: false,
    });
    return cloneRoom(record.room);
  }

  setReady(code: string, playerId: string, ready: boolean): Room {
    const record = this.requireRoom(code);
    const player = record.room.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new RoomServiceError("PLAYER_MISSING", "That player is no longer in this room.");
    }
    if (player.isHost) {
      throw new RoomServiceError("HOST_READINESS", "The host does not need to mark Ready.");
    }
    player.ready = ready;
    return cloneRoom(record.room);
  }

  getRoom(code: string): Room | null {
    const record = this.rooms.get(code.trim().toUpperCase());
    return record ? cloneRoom(record.room) : null;
  }

  getFixtureRoom(code: string): Room | null {
    const record = this.rooms.get(code.trim().toUpperCase());
    return record?.fixture ? cloneRoom(record.room) : null;
  }

  leaveRoom(code: string, playerId: string): void {
    const key = code.trim().toUpperCase();
    const record = this.rooms.get(key);
    if (!record) return;
    const player = record.room.players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    if (player.isHost && !record.fixture) {
      this.rooms.delete(key);
      return;
    }
    record.room.players = record.room.players.filter((candidate) => candidate.id !== playerId);
  }

  private requireRoom(code: string): RoomRecord {
    const record = this.rooms.get(code.trim().toUpperCase());
    if (!record) {
      throw new RoomServiceError("ROOM_MISSING", "This simulated room is no longer available.");
    }
    return record;
  }

  private makePlayerId(): string {
    const id = `player-${this.nextPlayerId}`;
    this.nextPlayerId += 1;
    return id;
  }

  private makeCode(): string {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
  }

  private seedFixtures(): void {
    const sunnyRoom: Room = {
      code: "SUNNY1",
      map: MAP_NAME,
      players: [{
        id: this.makePlayerId(),
        name: "Milo",
        team: "red",
        isHost: true,
        isCurrentPlayer: false,
        ready: true,
      }],
    };
    this.rooms.set(sunnyRoom.code, { room: sunnyRoom, fixture: true });

    const fullRoom: Room = {
      code: "FULL66",
      map: MAP_NAME,
      players: [
        { id: this.makePlayerId(), name: "Milo", team: "red", isHost: true, isCurrentPlayer: false, ready: true },
        { id: this.makePlayerId(), name: "Poppy", team: "red", isHost: false, isCurrentPlayer: false, ready: true },
        { id: this.makePlayerId(), name: "Taro", team: "blue", isHost: false, isCurrentPlayer: false, ready: false },
        { id: this.makePlayerId(), name: "Mina", team: "blue", isHost: false, isCurrentPlayer: false, ready: true },
        { id: this.makePlayerId(), name: "Bean", team: "yellow", isHost: false, isCurrentPlayer: false, ready: false },
        { id: this.makePlayerId(), name: "Ollie", team: "yellow", isHost: false, isCurrentPlayer: false, ready: true },
      ],
    };
    this.rooms.set(fullRoom.code, { room: fullRoom, fixture: true });
  }
}
