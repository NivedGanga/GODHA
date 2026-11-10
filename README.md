# GODHA · Sprint 2 room-flow prototype

A browser prototype for GODHA's cheerful pre-game flow: startup loading, player name, home, room creation and joining, host/guest lobbies, settings, maps, and game-start loading. It is built with plain HTML, CSS, and TypeScript.

## Run it

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/NivedGanga/GODHA.git
cd GODHA
npm ci
npm start
```

Open **http://localhost:3000**. The startup screen advances to the player-name form. The room code `AB12CD` opens a joinable demo room; `FULL88` is the six-player full-room fixture. Join feedback is specific: a blank code says **Enter a room code first.**, a malformed code says **Enter a six-character room code.**, an unknown code says **We couldn't find that room. Check the code and try again.**, and `FULL88` says **That room is full (6 of 6 players). Try another code.** A newly created room receives a generated six-character code.

Run the automated checks with:

```bash
npm test
```

## How the room simulation works

`src/room-service.ts` defines the `RoomService` interface and the local `SimulatedRoomService` adapter. The UI in `src/app.ts` imports only that service. It does **not** import `src/network.ts`, open a signaling WebSocket, construct an `RTCPeerConnection`, or make a real network room.

The service provides the seam for a later network-backed adapter. It owns room creation/joining, team assignment, guest readiness, and fixture data. Rooms have a six-player cap across four teams, with at most two players per team. The host plus at least one guest is required to start, and every guest must be Ready; all four teams do not need to be filled. New players are assigned to the first team with an open seat. The host lobby includes explicit simulated guest controls so the readiness and start states can be exercised in one browser. In the guest lobby, **SIMULATE HOST START** represents the host's action in this single-client preview; a real guest cannot start a match.

### Replacing the mock service later

1. Add a network-backed adapter (for example, `src/network-room-service.ts`) that implements `RoomService` and returns the same `Room` / `RoomPlayer` shapes. Keep room creation, membership, team assignment, capacity, and readiness authoritative on the server rather than duplicating those decisions in the browser.
2. The current `RoomService` methods are synchronous. If server calls are asynchronous, change the interface to return promises and update the UI event handlers in `src/app.ts` to await results while retaining the existing loading and inline-error states. Add an explicit subscription/update contract if the UI must render server-pushed room changes.
3. Switch the composition point at the top of `src/app.ts` from `new SimulatedRoomService()` to the new adapter, leaving screen rendering dependent on the service contract rather than transport details. Keep the signaling/WebRTC module separate until that integration is deliberately in scope.
4. Treat `AB12CD`, `FULL88`, `addSimulatedGuest`, and fixture lookup as preview/test-only behavior. Put production demo data behind a server-owned development seed or a separate optional demo capability; do not require those simulated controls in the production adapter.
5. Keep the simulated adapter for fast unit tests, then add shared adapter-contract tests and server integration tests for joining, capacity, team assignment, readiness, and distinct error feedback before enabling the network-backed adapter by default.

The sample codes are fixed, local fixtures: `AB12CD` (one simulated host; joinable) and `FULL88` (six players; full). The Maps dialog intentionally contains exactly one option: **Sunny Meadow**. Room state and the player name are held in memory only and reset on reload. Game-start loading ends at a labeled placeholder; gameplay and results are out of scope.

The existing Sprint 1 WebRTC module and signaling server remain in the repository but are not used by the Sprint 2 UI. Keep the Sprint 1 and Sprint 2 contracts separate until a later sprint explicitly connects them.

## Asset and temporary-art handoff

The three supplied transparent PNG assets are in `public/assets/` and are rendered with `object-fit: contain` so their proportions are preserved:

- `player-panda.png` — supplied player-name mascot; reused as a temporary mascot in the loading scenes.
- `home-cat-corgi.png` — supplied home-screen sofa artwork.
- `cabinet.png` — supplied host/guest lobby cabinet artwork.

Temporary and replaceable elements: the GODHA wordmark is editable HTML text; the start-up and game-start landscapes (including hill, island, arch, trees, and waterfalls) are CSS/HTML; the room-map thumbnail is a CSS meadow; player avatars are initials; and the join-dialog peeking cat is a small CSS placeholder. The initial-loading trio, running character poses, and original map thumbnail were not supplied as standalone art. There is no extracted screenshot used as a UI background, no sample player/room values from the references, and no Party Animals footer or copyright text. The font stack uses Fredoka (SIL Open Font License) from Google Fonts, with system rounded sans-serif fallbacks when it is unavailable.

## Run and verify notes

The prototype is designed responsively for desktop, smaller displays, and phone landscape. Check `TESTING.md` for the acceptance checklist and the sandbox-only verification record. Visual browser checks at the listed viewports should be recorded when performed; do not infer them from compilation or unit-test results.
