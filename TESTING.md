# GODHA Sprint 1 · Test report

**Status: prototype smoke-tested; full sprint sign-off is still pending.** The checks below distinguish observed results from tests that still need a tester or additional network conditions.

## Completed checks

| Check | Result and evidence |
|---|---|
| Automated suite | **Pass:** `npm test` builds both TypeScript targets and passes 3 test groups: UI-independent module import, room lifecycle/admission, and signaling relay restrictions. |
| Fresh install and startup | **Pass:** a fresh clone of commit `ddc0370` ran `npm ci`, `npm start` and all three test groups, serving the page and `/health` over HTTP. Environment: Node 24.22.1. This was a fresh checkout on the same machine, not a separate clean operating-system installation. |
| Four browser clients | **Pass:** one host and three guests in separate tabs on one browser instance showed the same four connected player names and four distinct starting positions. |
| Position sync | **Pass for sequential movement:** a brief arrow tap moved the host from x 25%, y 30% to x 27%, y 30%; all three guests displayed the new position. Clicking the canvas center moved the host to x 50%, y 50%, and all guests reflected it. Each guest then moved in turn, and all four clients showed the same updated positions. This did not measure latency or test simultaneous movement. |
| Direct peer connections | **Pass in the same-machine test:** the sample's `RTCPeerConnection.getStats()` diagnostics across the host and two guests covered all six pairs; every data channel was open and every selected candidate pair was `host ↔ host`. This does not prove connectivity across restrictive NATs. |
| Join errors | **Pass on the preceding build:** the browser UI showed distinct messages for an invalid code, a full room and a locked room. The final automated checks cover these and a closed room. |
| Leave, disconnect and rejoin | **Pass on the preceding build:** normal leave removed the player on other clients; a tab close showed a disconnect and removed the player; rejoining filled the slot without a stale duplicate and received the host's current position. The final automated suite covers the same server membership lifecycle. |
| Module independence | **Pass:** the module imported without a DOM in the automated test. The separate `/module-smoke.html` browser fixture created a room without loading the sample UI. |

An independent tester confirmed the revised brief arrow press changed x from 25% to 27%. The tester's attempted canvas-center click did not visibly change the position, unlike the separate browser test above; the reason is unconfirmed and deserves retesting. The independent browser controls did not expose separate clients, so independent confirmation of peer connectivity and cross-client sync remains open.

## TesterOne · connection-flow cases to repeat

1. Create a room, copy its code and join from three separate clients. Check all names and statuses converge.
2. Submit an invalid code, try a fifth client, lock joins, and try a code after the host leaves. Check the distinct messages and that rejected clients do not enter the roster.
3. Have a guest leave normally; then abruptly close another guest. Check status messages, roster removal and capacity recovery on the remaining clients.
4. Rejoin while the room is open. Check the old entry does not remain and the rejoining player receives current positions.
5. Move existing players before a late join; check that the newcomer sees their current positions.
6. Have the host leave; check the other clients are notified that the room is closed and the old code cannot be joined.

## TesterTwo · sync and network conditions still to test

- Move all four players simultaneously and verify every other client sees the correct positions; sequential movement has been checked above.
- Measure update delay with controlled added latency and simulated packet loss; record the tool, conditions, measurements and recovery behavior.
- Test a background tab for an extended interval, then foreground it and check convergence and disconnect behavior.
- Repeat from different devices and networks; inspect peer diagnostics or browser WebRTC statistics and record selected candidate types and data-channel state.
- Record failures and reproduction steps. There is no agreed numeric latency target in this sprint.

## Known test boundaries

No TURN server is configured. Restrictive networks can prevent direct connections; a successful same-machine `host ↔ host` result does not establish cross-network availability. Automatic reconnection, host migration and production deployment are outside this sprint.
