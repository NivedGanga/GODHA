import {
  canStartRoom,
  MAP_NAME,
  RoomServiceError,
  SimulatedRoomService,
  TEAMS,
  type Room,
  type RoomPlayer,
  type TeamId,
} from "./room-service.js";

const service = new SimulatedRoomService();
type ScreenId = "boot-screen" | "name-screen" | "home-screen" | "lobby-screen" | "game-loading-screen" | "complete-screen";
type LobbyRole = "host" | "guest";

const screens: ScreenId[] = [
  "boot-screen",
  "name-screen",
  "home-screen",
  "lobby-screen",
  "game-loading-screen",
  "complete-screen",
];
const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required GODHA UI element: ${selector}`);
  return element;
};

const focusTargets: Record<ScreenId, string> = {
  "boot-screen": "boot-title",
  "name-screen": "name-input",
  "home-screen": "create-room-button",
  "lobby-screen": "copy-code-button",
  "game-loading-screen": "game-loading-title",
  "complete-screen": "return-home-button",
};

const nameForm = $("#name-form");
const nameInput = $("#name-input") as HTMLInputElement;
const nameError = $("#name-error");
const profileName = $("#profile-name");
const profileAvatar = $("#profile-avatar");
const joinDialog = $("#join-dialog") as HTMLDialogElement;
const joinForm = $("#join-form");
const joinCodeInput = $("#join-code-input") as HTMLInputElement;
const joinError = $("#join-error");
const settingsDialog = $("#settings-dialog") as HTMLDialogElement;
const mapsDialog = $("#maps-dialog") as HTMLDialogElement;
const teamGrid = $("#team-grid");
const roomSummary = $("#room-summary");
const roomCodeValue = $("#room-code-value");
const mapNameElement = $("#map-name");
const lobbyStatus = $("#lobby-status");
const hostStartButton = $("#host-start-button") as HTMLButtonElement;
const guestReadyButton = $("#guest-ready-button") as HTMLButtonElement;
const hostDemoTools = $("#host-demo-tools");
const guestDemoTools = $("#guest-demo-tools");
const addGuestButton = $("#add-guest-button") as HTMLButtonElement;
const simulateHostStartButton = $("#simulate-host-start-button") as HTMLButtonElement;
const guestHostNote = $("#guest-host-note");
const gameProgress = $("#game-progress");
const gameProgressTrack = $("#game-progress-track");
const gamePercent = $("#game-percent");

let currentScreen: ScreenId = "boot-screen";
let playerName = "";
let activeRoom: Room | null = null;
let currentRole: LobbyRole | null = null;
let localPlayerId = "";
let copyFeedbackTimer = 0;
let startTransitionTimer = 0;

function showScreen(next: ScreenId, focus = true): void {
  currentScreen = next;
  for (const id of screens) {
    const screen = document.getElementById(id);
    if (screen) screen.hidden = id !== next;
  }
  if (focus) {
    window.requestAnimationFrame(() => {
      document.getElementById(focusTargets[next])?.focus({ preventScroll: true });
    });
  }
}

function showInlineError(target: HTMLElement, input: HTMLInputElement, message: string): void {
  target.textContent = message;
  target.hidden = false;
  input.setAttribute("aria-invalid", "true");
}

function clearInlineError(target: HTMLElement, input: HTMLInputElement): void {
  target.textContent = "";
  target.hidden = true;
  input.removeAttribute("aria-invalid");
}

function updateProfile(): void {
  profileName.textContent = playerName;
  profileAvatar.textContent = playerName.trim().slice(0, 1).toUpperCase() || "?";
  profileAvatar.setAttribute("aria-label", `${playerName}'s avatar placeholder`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function openDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}

function findLocalPlayer(room: Room): RoomPlayer | undefined {
  return room.players.find((player) => player.id === localPlayerId);
}

function getTeamPlayers(room: Room, teamId: TeamId): RoomPlayer[] {
  return room.players.filter((player) => player.team === teamId);
}

function makeAvatar(player: RoomPlayer, teamColor: string): HTMLSpanElement {
  const avatar = document.createElement("span");
  avatar.className = "seat-avatar";
  avatar.textContent = player.name.trim().slice(0, 1).toUpperCase() || "?";
  avatar.style.setProperty("--team-color", teamColor);
  avatar.setAttribute("aria-hidden", "true");
  return avatar;
}

function makeReadinessControl(player: RoomPlayer): HTMLElement {
  if (currentRole === "host" && !player.isHost) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `ready-badge ${player.ready ? "is-ready" : "is-not-ready"}`;
    toggle.textContent = player.ready ? "✓ READY" : "NOT READY";
    toggle.setAttribute("aria-label", `${player.ready ? "Mark" : "Mark"} ${player.name} ${player.ready ? "not ready" : "ready"}`);
    toggle.addEventListener("click", () => {
      if (!activeRoom) return;
      activeRoom = service.setReady(activeRoom.code, player.id, !player.ready);
      renderLobby();
    });
    return toggle;
  }

  const badge = document.createElement("span");
  if (player.isHost) {
    badge.className = "role-badge host-badge";
    badge.textContent = currentRole === "host" && player.isCurrentPlayer ? "♛ HOST · YOU" : "♛ HOST";
  } else {
    badge.className = `ready-badge ${player.ready ? "is-ready" : "is-not-ready"}`;
    badge.textContent = player.ready ? "✓ READY" : "NOT READY";
  }
  return badge;
}

function makeSeat(player: RoomPlayer | undefined, teamColor: string): HTMLElement {
  const seat = document.createElement("div");
  seat.className = player ? "player-seat" : "player-seat empty-seat";
  if (!player) {
    const emptyMark = document.createElement("span");
    emptyMark.className = "empty-seat-mark";
    emptyMark.textContent = "+";
    const emptyLabel = document.createElement("span");
    emptyLabel.textContent = "Open seat";
    seat.append(emptyMark, emptyLabel);
    return seat;
  }

  const avatar = makeAvatar(player, teamColor);
  const copy = document.createElement("span");
  copy.className = "seat-copy";
  const name = document.createElement("strong");
  name.className = "seat-name";
  name.textContent = player.name;
  const meta = document.createElement("small");
  meta.className = "seat-meta";
  meta.textContent = player.isHost ? "ROOM HOST" : player.isCurrentPlayer ? "YOU · GUEST" : "GUEST";
  copy.append(name, meta);
  seat.append(avatar, copy, makeReadinessControl(player));
  if (player.isCurrentPlayer) seat.classList.add("is-current-player");
  return seat;
}

function renderTeamGrid(room: Room): void {
  teamGrid.replaceChildren();
  for (const team of TEAMS) {
    const players = getTeamPlayers(room, team.id);
    const card = document.createElement("section");
    card.className = `team-card team-${team.id}`;
    card.style.setProperty("--team-color", team.color);
    card.setAttribute("aria-label", `${team.label} team, ${players.length} of 2 players`);

    const header = document.createElement("header");
    header.className = "team-header";
    const label = document.createElement("h2");
    label.textContent = team.label.toUpperCase();
    const count = document.createElement("span");
    count.className = "team-count";
    count.textContent = `${players.length}/2`;
    header.append(label, count);

    const seats = document.createElement("div");
    seats.className = "team-seats";
    seats.append(makeSeat(players[0], team.color), makeSeat(players[1], team.color));
    card.append(header, seats);
    teamGrid.append(card);
  }
}

function describeLobby(room: Room): string {
  const guests = room.players.filter((player) => !player.isHost);
  if (currentRole === "host") {
    if (guests.length === 0) return "Waiting for a guest to join. Start needs the host plus at least one guest.";
    if (guests.some((guest) => !guest.ready)) return "Waiting for every guest to be Ready. Full teams are not required.";
    return "All guests are Ready. You can start the game preview.";
  }
  const localPlayer = findLocalPlayer(room);
  if (!localPlayer?.ready) return "You are not Ready yet. Toggle Ready when you are set.";
  if (guests.some((guest) => !guest.ready)) return "You are Ready. Waiting for the other guests and host.";
  return "Everyone is Ready. Waiting for the host to start.";
}

function renderLobby(): void {
  if (!activeRoom || !currentRole) return;
  roomCodeValue.textContent = activeRoom.code;
  mapNameElement.textContent = MAP_NAME;
  roomSummary.textContent = `${activeRoom.players.length} / 6 PLAYERS  ·  FOUR TEAMS, TWO SEATS EACH`;
  renderTeamGrid(activeRoom);
  lobbyStatus.textContent = describeLobby(activeRoom);

  const hostView = currentRole === "host";
  hostStartButton.hidden = !hostView;
  hostStartButton.disabled = !canStartRoom(activeRoom);
  guestReadyButton.hidden = hostView;
  hostDemoTools.hidden = !hostView;
  guestDemoTools.hidden = hostView;
  $("#open-maps-button").hidden = !hostView;
  addGuestButton.disabled = activeRoom.players.length >= 6;
  addGuestButton.textContent = activeRoom.players.length >= 6 ? "ROOM FULL · 6/6" : "＋ ADD SIMULATED GUEST";

  if (!hostView) {
    const localPlayer = findLocalPlayer(activeRoom);
    const isReady = Boolean(localPlayer?.ready);
    guestReadyButton.textContent = isReady ? "✓ READY · ON" : "✓ READY";
    guestReadyButton.setAttribute("aria-pressed", String(isReady));
    guestReadyButton.classList.toggle("is-toggled", isReady);
    simulateHostStartButton.disabled = !canStartRoom(activeRoom);
    guestHostNote.textContent = canStartRoom(activeRoom)
      ? "Everyone is Ready. Use this demo control to represent the host starting."
      : "Mark Ready and wait until every guest is Ready.";
    simulateHostStartButton.textContent = canStartRoom(activeRoom) ? "SIMULATE HOST START" : "WAITING FOR READY PLAYERS";
  }
}

function enterLobby(room: Room, role: LobbyRole): void {
  activeRoom = room;
  currentRole = role;
  const localPlayer = room.players.find((player) => player.isCurrentPlayer);
  if (!localPlayer) throw new Error("The simulated room did not return the local player.");
  localPlayerId = localPlayer.id;
  closeDialog(joinDialog);
  renderLobby();
  showScreen("lobby-screen");
}

function leaveLobby(): void {
  if (activeRoom) service.leaveRoom(activeRoom.code, localPlayerId);
  activeRoom = null;
  currentRole = null;
  localPlayerId = "";
  showScreen("home-screen");
}

function startGameLoading(): void {
  if (startTransitionTimer) window.clearTimeout(startTransitionTimer);
  showScreen("game-loading-screen");
  const duration = 4200;
  const startedAt = performance.now();
  const update = (now: number): void => {
    const progress = Math.min(100, Math.round(((now - startedAt) / duration) * 100));
    gameProgress.style.width = `${progress}%`;
    gameProgressTrack.setAttribute("aria-valuenow", String(progress));
    gamePercent.textContent = `${progress}%`;
    if (progress < 100) {
      window.requestAnimationFrame(update);
    } else {
      startTransitionTimer = window.setTimeout(() => showScreen("complete-screen"), 450);
    }
  };
  gameProgress.style.width = "0%";
  gameProgressTrack.setAttribute("aria-valuenow", "0");
  gamePercent.textContent = "0%";
  window.requestAnimationFrame(update);
}

function fallbackCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "visually-hidden";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

async function copyRoomCode(): Promise<void> {
  if (!activeRoom) return;
  const code = activeRoom.code;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      copied = true;
    }
  } catch {
    copied = fallbackCopy(code);
  }
  if (!copied) copied = fallbackCopy(code);
  if (copied) {
    const copyButton = $("#copy-code-button") as HTMLButtonElement;
    copyButton.classList.add("copied");
    copyButton.setAttribute("aria-label", "Copied!");
    copyButton.querySelector(".copy-icon")!.textContent = "✓";
    lobbyStatus.textContent = "Copied!";
    if (copyFeedbackTimer) window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
      copyButton.classList.remove("copied");
      copyButton.setAttribute("aria-label", "Copy room code");
      copyButton.querySelector(".copy-icon")!.textContent = "▢";
    }, 1600);
  } else {
    lobbyStatus.textContent = `Copy unavailable. Room code: ${code}`;
  }
}

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = nameInput.value.trim();
  if (!value) {
    showInlineError(nameError, nameInput, "Please enter a player name to continue.");
    nameInput.focus();
    return;
  }
  playerName = value.slice(0, 24);
  clearInlineError(nameError, nameInput);
  updateProfile();
  showScreen("home-screen");
});

nameInput.addEventListener("input", () => clearInlineError(nameError, nameInput));

$("#create-room-button").addEventListener("click", () => {
  try {
    const room = service.createRoom(playerName);
    enterLobby(room, "host");
  } catch (error) {
    lobbyStatus.textContent = errorMessage(error);
  }
});

$("#open-join-button").addEventListener("click", () => {
  clearInlineError(joinError, joinCodeInput);
  joinCodeInput.value = "";
  openDialog(joinDialog);
  window.setTimeout(() => joinCodeInput.focus(), 0);
});

$("#open-settings-button").addEventListener("click", () => openDialog(settingsDialog));

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/\s/g, "").slice(0, 6);
  clearInlineError(joinError, joinCodeInput);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = joinCodeInput.value.trim().toUpperCase();
  try {
    const room = service.joinRoom(playerName, code);
    enterLobby(room, "guest");
  } catch (error) {
    const message = error instanceof RoomServiceError ? error.message : errorMessage(error);
    showInlineError(joinError, joinCodeInput, message);
    joinCodeInput.focus();
  }
});

$("#cancel-join-button").addEventListener("click", () => closeDialog(joinDialog));
for (const dialog of [joinDialog, settingsDialog, mapsDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.querySelector(".modal-close")?.addEventListener("click", () => closeDialog(dialog));
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".modal-done-button")) {
  button.addEventListener("click", () => {
    const dialog = button.closest("dialog");
    if (dialog) closeDialog(dialog);
  });
}

$("#open-maps-button").addEventListener("click", () => openDialog(mapsDialog));
$("#sunny-meadow-option").addEventListener("click", () => {
  mapNameElement.textContent = MAP_NAME;
  closeDialog(mapsDialog);
});

$("#copy-code-button").addEventListener("click", () => void copyRoomCode());

hostStartButton.addEventListener("click", () => {
  if (currentRole === "host" && activeRoom && canStartRoom(activeRoom)) startGameLoading();
});

guestReadyButton.addEventListener("click", () => {
  if (!activeRoom) return;
  const localPlayer = findLocalPlayer(activeRoom);
  if (!localPlayer || localPlayer.isHost) return;
  activeRoom = service.setReady(activeRoom.code, localPlayer.id, !localPlayer.ready);
  renderLobby();
});

addGuestButton.addEventListener("click", () => {
  if (!activeRoom || currentRole !== "host") return;
  try {
    activeRoom = service.addSimulatedGuest(activeRoom.code);
    renderLobby();
  } catch (error) {
    lobbyStatus.textContent = errorMessage(error);
  }
});

simulateHostStartButton.addEventListener("click", () => {
  if (currentRole === "guest" && activeRoom && canStartRoom(activeRoom)) startGameLoading();
});

$("#leave-room-button").addEventListener("click", leaveLobby);
$("#return-home-button").addEventListener("click", () => {
  activeRoom = null;
  currentRole = null;
  localPlayerId = "";
  showScreen("home-screen");
});

const bootProgress = $("#boot-progress");
const bootTrack = $("#boot-screen .progress-track");
let bootValue = 4;
const bootTimer = window.setInterval(() => {
  bootValue = Math.min(100, bootValue + 11);
  bootProgress.style.width = `${bootValue}%`;
  bootTrack.setAttribute("aria-valuenow", String(bootValue));
}, 120);
window.setTimeout(() => {
  window.clearInterval(bootTimer);
  bootProgress.style.width = "100%";
  bootTrack.setAttribute("aria-valuenow", "100");
  showScreen("name-screen");
}, 1250);
