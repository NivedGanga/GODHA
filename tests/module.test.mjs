import assert from "node:assert/strict";
import test from "node:test";
import { GodhaNetwork } from "../public/js/network.js";

test("network module imports and exposes local state without a UI or DOM", () => {
  const network = new GodhaNetwork("ws://localhost:3000/signal");
  assert.deepEqual(network.getPlayers(), []);
  assert.equal(network.getRoomCode(), null);
  assert.equal(network.isHost(), false);
  const unsubscribe = network.on(() => {});
  network.updatePosition(0.25, 0.75); // no room: a safe no-op
  assert.deepEqual(network.getPlayers(), []);
  unsubscribe();
});
