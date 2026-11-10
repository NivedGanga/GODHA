import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { createGodhaServer } from "../dist/server.js";

async function startServer() {
  const instance = createGodhaServer();
  instance.httpServer.listen(0, "127.0.0.1");
  await once(instance.httpServer, "listening");
  const address = instance.httpServer.address();
  const url = `ws://127.0.0.1:${address.port}/signal`;
  return {
    ...instance,
    url,
    async close() {
      for (const socket of instance.webSocketServer.clients) socket.terminate();
      await new Promise((resolve) => instance.webSocketServer.close(() => resolve()));
      await new Promise((resolve, reject) => instance.httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  await once(socket, "open");

  function waitFor(predicate, timeoutMs = 2000) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error("Timed out waiting for signaling response"));
        }, timeoutMs),
      };
      waiters.push(waiter);
    });
  }

  async function request(message) {
    const response = waitFor((value) => value.type === "error" || value.type === expectedResponse(message.type));
    socket.send(JSON.stringify(message));
    return response;
  }

  return { socket, waitFor, request };
}

function expectedResponse(type) {
  return ({
    "create-room": "room-created",
    "join-room": "room-joined",
    "leave-room": "left-room",
    "set-accepting-joins": "room-setting-updated",
  })[type] ?? "error";
}

async function closeClient(client) {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  if (client.socket.readyState !== WebSocket.CLOSING) client.socket.close();
  await Promise.race([once(client.socket, "close"), new Promise((resolve) => setTimeout(resolve, 500))]);
}

test("room registration enforces code, capacity, join lock and host-close behavior", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const clients = [];
  t.after(async () => Promise.all(clients.map(closeClient)));

  const host = await connect(server.url);
  clients.push(host);
  const created = await host.request({ type: "create-room" });
  assert.equal(created.type, "room-created");
  assert.match(created.roomCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(created.player.name, "Player 1");
  assert.equal(created.player.slot, 0);

  const badCodeClient = await connect(server.url);
  clients.push(badCodeClient);
  const invalid = await badCodeClient.request({ type: "join-room", roomCode: "ZZZZZZ" });
  assert.equal(invalid.code, "invalid-room-code");

  const guests = [];
  for (let index = 0; index < 3; index += 1) {
    const guest = await connect(server.url);
    clients.push(guest);
    const joined = await guest.request({ type: "join-room", roomCode: created.roomCode.toLowerCase() });
    assert.equal(joined.type, "room-joined");
    assert.equal(joined.peers.length, index + 1);
    assert.equal(joined.player.slot, index + 1);
    guests.push({ client: guest, player: joined.player });
    const arrival = await host.waitFor((message) => message.type === "peer-joined" && message.player.id === joined.player.id);
    assert.equal(arrival.player.name, joined.player.name);
  }

  const fifth = await connect(server.url);
  clients.push(fifth);
  const full = await fifth.request({ type: "join-room", roomCode: created.roomCode });
  assert.equal(full.code, "room-full");

  const departed = guests[2];
  const leftNotice = host.waitFor((message) => message.type === "peer-left" && message.playerId === departed.player.id);
  assert.equal((await departed.client.request({ type: "leave-room" })).type, "left-room");
  assert.equal((await leftNotice).reason, "left");
  const rejoined = await departed.client.request({ type: "join-room", roomCode: created.roomCode });
  assert.equal(rejoined.type, "room-joined");
  assert.notEqual(rejoined.player.id, departed.player.id);
  assert.equal(rejoined.player.slot, departed.player.slot);
  assert.equal(rejoined.peers.some((peer) => peer.id === departed.player.id), false);
  await host.waitFor((message) => message.type === "peer-joined" && message.player.id === rejoined.player.id);

  const dropped = guests[1];
  const dropNotice = host.waitFor((message) => message.type === "peer-left" && message.playerId === dropped.player.id);
  dropped.client.socket.terminate();
  assert.equal((await dropNotice).reason, "disconnected");
  const afterDrop = await fifth.request({ type: "join-room", roomCode: created.roomCode });
  assert.equal(afterDrop.type, "room-joined");
  assert.equal(afterDrop.player.slot, dropped.player.slot);
  assert.equal(afterDrop.peers.some((peer) => peer.id === dropped.player.id), false);

  const lockResponse = await host.request({ type: "set-accepting-joins", accepting: false });
  assert.equal(lockResponse.type, "room-setting-updated");
  assert.equal(lockResponse.acceptingJoins, false);
  const roomState = await host.waitFor((message) => message.type === "room-state");
  assert.equal(roomState.acceptingJoins, false);
  const afterLock = await badCodeClient.request({ type: "join-room", roomCode: created.roomCode });
  assert.equal(afterLock.code, "room-not-accepting");

  const leave = await host.request({ type: "leave-room" });
  assert.equal(leave.type, "left-room");
  const closed = await badCodeClient.request({ type: "join-room", roomCode: created.roomCode });
  assert.equal(closed.code, "room-unavailable");
});

test("signaling relays setup payloads only to the addressed room peer, not game-state messages", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const host = await connect(server.url);
  const guest = await connect(server.url);
  t.after(async () => Promise.all([closeClient(host), closeClient(guest)]));

  const created = await host.request({ type: "create-room" });
  const joined = await guest.request({ type: "join-room", roomCode: created.roomCode });
  await host.waitFor((message) => message.type === "peer-joined" && message.player.id === joined.player.id);

  const setupPayload = { kind: "description", description: { type: "offer", sdp: "test-offer" } };
  const relayed = guest.waitFor((message) => message.type === "signal" && message.fromId === created.player.id);
  host.socket.send(JSON.stringify({ type: "signal", targetId: joined.player.id, signal: setupPayload }));
  assert.deepEqual((await relayed).signal, setupPayload);

  const notSignaling = host.request({ type: "position", x: 0.25, y: 0.5 });
  assert.equal((await notSignaling).code, "unknown-message");
  const disguisedState = await host.request({ type: "signal", targetId: joined.player.id, signal: { kind: "position", x: 0.25, y: 0.5 } });
  assert.equal(disguisedState.code, "invalid-signal");
});
