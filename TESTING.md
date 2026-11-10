# GODHA Sprint 2 prototype checks

## Automated

Run `npm test`. The suite includes the Sprint 1 network/signaling tests plus Sprint 2 room-service tests covering:

- the `AB12CD` joinable fixture and `FULL88` six-player full fixture;
- generated six-character room codes and required player names;
- malformed, unknown, and full room-code behavior;
- a six-player maximum and two seats per team;
- Ready state updates and Start conditions (host + at least one guest, all guests Ready, teams need not be full).

## Browser flow checklist

Use a sandbox or other approved test browser; do not use the owner's Mac for project testing.

1. Startup loading transitions to Player Name; a blank name shows an inline error.
2. A valid name opens Home and is shown in the profile chip.
3. Settings opens and closes, including with Escape.
4. Create Room shows a six-character code, `SIMULATED`, the host, four teams, two seats per team, and **Sunny Meadow**. Copy room code reports **Copied!**.
5. Start stays disabled with the host alone. Add one simulated guest, then mark that guest Ready. Start becomes available even though teams are not full. Add another guest left Not Ready; Start disables until every guest is Ready.
6. Joining with a blank value shows **Enter a room code first.**; a malformed value shows **Enter a six-character room code.**; an unknown six-character value shows **We couldn't find that room. Check the code and try again.**; and `FULL88` shows **That room is full (6 of 6 players). Try another code.** Verify each message appears inline in the join dialog and differs from the other three. `AB12CD` opens the guest lobby.
7. Guest Ready toggles between Ready and Not Ready. The simulated-host action stays unavailable until the host plus at least one guest are present and all guests are Ready; once available it leads to game-start loading.
8. Maps opens and closes, and contains only the `Sunny Meadow` option.
9. Cancel, the close button, and Escape dismiss the Join dialog. All controls can be reached and activated by keyboard.
10. Game-start loading advances through changing percentages to 100% and stops at the labeled placeholder.
11. Inspect at 1920×1080, 1366×768, and phone landscape. Confirm the provided art keeps its proportions and transparency, and text or controls do not overlap or clip.

## Verification record

On the Linux Sandbox, `npm ci && npm test` passed all 10 tests after the clean-build and feedback changes. A Chromium 151.0.7922.34 smoke check verified distinct inline messages for blank, malformed, unknown, and full room codes; `AB12CD` opened a guest lobby with 2/6 players and all four team cards; and `FULL88` was rejected with “That room is full (6 of 6 players). Try another code.” No uncaught browser exceptions occurred. The broader viewport checklist above was not rerun. No project testing was performed on the owner’s Mac.
