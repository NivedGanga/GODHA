import test from "node:test";
import assert from "node:assert/strict";
import {
  canStartRoom,
  MAX_PLAYERS,
  ROOM_CODE_PATTERN,
  RoomServiceError,
  SimulatedRoomService,
  TEAMS,
} from "../public/js/room-service.js";

function service() {
  return new SimulatedRoomService();
}

test("room fixtures include the approved open and exactly six-player full rooms", () => {
  const rooms = service();
  const open = rooms.getFixtureRoom("AB12CD");
  const full = rooms.getFixtureRoom("FULL88");

  assert.equal(open.code, "AB12CD");
  assert.equal(open.players.length, 1);
  assert.equal(open.players[0].isHost, true);
  assert.equal(full.code, "FULL88");
  assert.equal(full.players.length, 6);
  assert.equal(full.players.filter((player) => player.isHost).length, 1);
  assert.equal(full.map, "Sunny Meadow");
  assert.equal(MAX_PLAYERS, 6);
});

test("created rooms have six-character codes and a local host", () => {
  const room = service().createRoom("River");
  assert.match(room.code, ROOM_CODE_PATTERN);
  assert.equal(room.players.length, 1);
  assert.equal(room.players[0].name, "River");
  assert.equal(room.players[0].isHost, true);
  assert.equal(room.players[0].isCurrentPlayer, true);
});

test("a host needs one guest and every guest ready; full teams are not required", () => {
  const rooms = service();
  let room = rooms.createRoom("Host");
  assert.equal(canStartRoom(room), false);

  room = rooms.addSimulatedGuest(room.code);
  assert.equal(room.players.length, 2);
  assert.equal(canStartRoom(room), false);
  assert.equal(room.players.filter((player) => player.team === "red").length, 2);
  room = rooms.setReady(room.code, room.players[1].id, true);
  assert.equal(canStartRoom(room), true);

  room = rooms.addSimulatedGuest(room.code);
  assert.equal(canStartRoom(room), false);
  const secondGuest = room.players.at(-1);
  room = rooms.setReady(room.code, secondGuest.id, true);
  assert.equal(canStartRoom(room), true);
  assert.ok(room.players.length < MAX_PLAYERS);
});

test("guests can join AB12CD and readiness updates are returned to the room view", () => {
  const rooms = service();
  let room = rooms.joinRoom("Player", "ab12cd");
  assert.equal(room.code, "AB12CD");
  assert.equal(room.players.length, 2);
  assert.equal(room.players[1].isCurrentPlayer, true);
  assert.equal(room.players[1].ready, false);
  assert.equal(canStartRoom(room), false);

  room = rooms.setReady(room.code, room.players[1].id, true);
  assert.equal(room.players[1].ready, true);
  assert.equal(canStartRoom(room), true);
});

test("joining shows distinct feedback for missing, malformed, unknown, and full room codes", () => {
  const rooms = service();
  const failures = [
    ["", "ROOM_CODE_REQUIRED", "Enter a room code first."],
    ["BAD", "INVALID_CODE", "Enter a six-character room code."],
    ["ABC123", "ROOM_NOT_FOUND", "We couldn't find that room. Check the code and try again."],
    ["FULL88", "ROOM_FULL", "That room is full (6 of 6 players). Try another code."],
  ];
  for (const [code, expectedCode, expectedMessage] of failures) {
    assert.throws(() => rooms.joinRoom("Player", code), (error) => {
      assert.ok(error instanceof RoomServiceError);
      assert.equal(error.code, expectedCode);
      assert.equal(error.message, expectedMessage);
      return true;
    });
  }
});

test("the room never exceeds six players or two players per team", () => {
  const rooms = service();
  let room = rooms.createRoom("Host");
  while (room.players.length < MAX_PLAYERS) room = rooms.addSimulatedGuest(room.code);
  assert.equal(room.players.length, 6);
  for (const team of TEAMS) {
    assert.ok(room.players.filter((player) => player.team === team.id).length <= 2);
  }
  assert.throws(() => rooms.addSimulatedGuest(room.code), (error) => error.code === "ROOM_FULL");
});

test("player names are required", () => {
  assert.throws(() => service().createRoom("  "), (error) => error.code === "NAME_REQUIRED");
});
