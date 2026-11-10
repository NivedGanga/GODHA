# GODHA Sprint 2 prototype checks

## Automated

Run `npm test`. The suite includes the Sprint 1 network/signaling tests plus Sprint 2 room-service tests covering:

- the `SUNNY1` joinable fixture and `FULL66` six-player full fixture;
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
6. Joining with a blank value, malformed value, unknown six-character value, or `FULL66` shows an inline message. `SUNNY1` opens the guest lobby.
7. Guest Ready toggles between Ready and Not Ready. The simulated-host action stays unavailable until the host plus at least one guest are present and all guests are Ready; once available it leads to game-start loading.
8. Maps opens and closes, and contains only the `Sunny Meadow` option.
9. Cancel, the close button, and Escape dismiss the Join dialog. All controls can be reached and activated by keyboard.
10. Game-start loading advances through changing percentages to 100% and stops at the labeled placeholder.
11. Inspect at 1920×1080, 1366×768, and phone landscape. Confirm the provided art keeps its proportions and transparency, and text or controls do not overlap or clip.

## Verification record

The final build and automated suite passed in the cloud sandbox: `npm test` reports 10/10 tests. A Chromium/Playwright smoke flow exercised name validation, Settings and Join dialog dismissal, missing/malformed/unknown/full/valid room codes, `SUNNY1`, clipboard feedback, the one-option Sunny Meadow dialog, guest Ready toggling, host Start gating with solo/not-ready/all-ready guests, and the game-loading placeholder; no uncaught page errors occurred. Visual renders were inspected at 1920×1080, 1366×768, and 844×390, with no horizontal overflow. The lobby fits the desktop and laptop document heights; in phone landscape its panel scrolls internally (551px content within a 372px panel), keeping all four teams accessible. No project testing was performed on the owner’s Mac.
