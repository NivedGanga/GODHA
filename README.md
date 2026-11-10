# GODHA · Sprint 1 connection and sync prototype

A browser-based foundation for room creation, code-based joining and small-room state sync. The network module is TypeScript and framework-agnostic; the sample UI is plain HTML, CSS and TypeScript compiled to native browser modules.

## Run it

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/NivedGanga/GODHA.git
cd GODHA
npm ci
npm start
```

`npm start` builds the TypeScript and starts the HTTP/signaling server. Open **http://localhost:3000** in up to four separate browser tabs. One tab creates a room; the other tabs join using its six-character code. Each client has its own local dot. Use the arrow keys to move it or click/tap a position on the canvas. The host can lock and unlock new joins.

For a clean-machine check, use the commands above in a fresh checkout, then verify the page loads and a room can be created. Run all automated checks with `npm test`.

The server listens on port 3000 by default; set `PORT` to use a different port. Use the same browser origin for all local clients. Hosting over HTTPS with a corresponding secure WebSocket (`wss:`) is needed for deployments outside localhost; production hosting is out of scope.

## What is in the prototype

- `src/network.ts` — framework-independent `GodhaNetwork` API and WebRTC full-mesh connections.
- `src/server.ts` — room registration, admission, room controls and SDP/ICE setup relay; it does not relay player positions.
- `src/app.ts` and `public/` — minimal sample controls, player status list and shared 2D dot canvas.
- `public/module-smoke.html` — standalone browser fixture that imports the network module without the sample UI.
- `tests/` — automated module and signaling integration checks. See `TESTING.md` for results and remaining coverage.

The room allows at most four players. Each client creates a direct `RTCPeerConnection` and ordered `RTCDataChannel` to every other player. One side per pair is selected deterministically by player ID to avoid duplicate offers. Public Google STUN servers are configured. TURN is intentionally not configured; its future insertion point is marked next to the STUN configuration in `src/network.ts`.

Room registration and deregistration, join admission, SDP offers/answers and ICE candidates use the WebSocket signaling server. Position updates, direct `hello`/leave messages and heartbeats use data channels after peer setup. The server's departure and room-lock notifications are room-management messages, not game or position traffic.

## Network module API

Import `GodhaNetwork` from `src/network.ts` (or `public/js/network.js` after building):

```ts
const network = new GodhaNetwork();
const unsubscribe = network.on((event) => {
  if (event.type === "players") renderPlayers(event.players);
  if (event.type === "status") showStatus(event.message);
  if (event.type === "error") showError(event.message);
  if (event.type === "room") configureRoom(event.roomCode, event.isHost);
});

const code = await network.createRoom();
// or: await network.joinRoom(code)
network.updatePosition(0.4, 0.6); // normalized x/y values in [0, 1]
const players = network.getPlayers();
const peerStats = await network.getPeerDiagnostics(); // WebRTC state and candidate-pair stats
await network.setAcceptingJoins(false); // host only
await network.leaveRoom();
unsubscribe();
```

The API contains no UI, renderer or game-physics code. Player positions are normalized 2D coordinates. `Player.status` is `connecting`, `connected` or `disconnected`; departure produces a status event and removes the player from the active list. Events include current player snapshots so consumers do not need to manage network internals.

## Acceptance checks and test report

Automated tests cover room code creation, joining, invalid codes, four-player capacity, departure, disconnect and rejoin, locked-room rejection, host-close/unavailable-room behavior, and targeted signaling relay. The suite also checks that a game-state message is not accepted by the signaling server. Run them with:

```bash
npm test
```

The following repeatable checks require browser clients; actual results and remaining gaps are recorded in `TESTING.md`:

1. Create a room in one tab; join from three other tabs. Confirm all four lists converge to the same player names and connection statuses.
2. Move each dot with arrow keys and canvas clicks. Confirm every other client shows the positions updating while moving.
3. Try an invalid code, a fifth client, and a join while the host has locked the room. Confirm each gets the corresponding clear message.
4. Make a late join after existing players have moved. Confirm the newcomer receives their current positions.
5. Leave normally, then close a client tab to simulate a dropped connection. Confirm other clients show a departure status and remove the player from the active list; rejoin without a stale duplicate.
6. Click **Peer diagnostics** or use browser WebRTC diagnostics to confirm each pair has an open data channel and a selected non-relay candidate pair. The signaling server rejects position payloads; inspect its messages to confirm only setup and room-management traffic is sent through `/signal`.
7. Test three or more clients under added latency, simulated packet loss and background-tab throttling; record actual delay, recovery and any divergence. The prototype does not promise a numeric latency threshold.
8. Open `http://localhost:3000/module-smoke.html` to check the network module in a minimal page that does not load the sample UI. It creates a temporary room and closes it when the tab closes.

## Known limitations

- No TURN relay is included, so restrictive NATs, firewalls or network policies can prevent direct peer connection.
- Full mesh is suitable for the four-player sprint cap; connection count and traffic grow with room size.
- If the host leaves, the room closes; host migration and persistence are out of scope. The closed code is reported unavailable for 15 minutes.
- Reconnection is manual: rejoin with the code while the host room remains open and has capacity. There is no automatic state rollback or conflict resolution.
- State sync is best-effort latest-position replication over ordered reliable data channels. There is no interpolation, authoritative simulation, game rules, physics, accounts or matchmaking.
- Browser background throttling and network changes can affect update timing and disconnect detection. Measure these in the browser test pass.
- Run instructions target localhost. A public HTTPS/WSS deployment and production hardening are out of scope.
