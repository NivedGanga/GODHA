import { GodhaNetwork, type Player, type PlayerStatus } from "./network.js";

const network = new GodhaNetwork();
const createButton = document.querySelector<HTMLButtonElement>("#create-button")!;
const joinButton = document.querySelector<HTMLButtonElement>("#join-button")!;
const joinInput = document.querySelector<HTMLInputElement>("#room-code-input")!;
const roomDetails = document.querySelector<HTMLElement>("#room-details")!;
const roomCodeDisplay = document.querySelector<HTMLElement>("#room-code-display")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-button")!;
const lockButton = document.querySelector<HTMLButtonElement>("#lock-button")!;
const diagnosticsButton = document.querySelector<HTMLButtonElement>("#diagnostics-button")!;
const diagnostics = document.querySelector<HTMLElement>("#diagnostics")!;
const leaveButton = document.querySelector<HTMLButtonElement>("#leave-button")!;
const statusBox = document.querySelector<HTMLElement>("#status")!;
const playerList = document.querySelector<HTMLUListElement>("#player-list")!;
const playerCount = document.querySelector<HTMLElement>("#player-count")!;
const canvas = document.querySelector<HTMLCanvasElement>("#playfield")!;
const context = canvas.getContext("2d")!;

const pressedKeys = new Set<string>();
let players: Player[] = [];
let statusResetTimer = 0;

function showStatus(message: string, isError = false): void {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
  if (statusResetTimer) window.clearTimeout(statusResetTimer);
  if (isError) {
    statusResetTimer = window.setTimeout(() => statusBox.classList.remove("error"), 6000);
  }
}

function refreshRoomControls(): void {
  const inRoom = network.getRoomCode() !== null;
  roomDetails.hidden = !inRoom;
  createButton.disabled = inRoom;
  joinButton.disabled = inRoom;
  joinInput.disabled = inRoom;
  if (inRoom) {
    roomCodeDisplay.textContent = network.getRoomCode()!;
    lockButton.hidden = !network.isHost();
    lockButton.textContent = network.isAcceptingJoins() ? "Lock joins" : "Unlock joins";
  } else {
    roomCodeDisplay.textContent = "------";
    lockButton.hidden = true;
    diagnostics.hidden = true;
  }
}

function statusLabel(status: PlayerStatus): string {
  switch (status) {
    case "connected": return "Connected";
    case "connecting": return "Connecting";
    case "disconnected": return "Disconnected";
  }
}

function colorFor(id: string): string {
  let value = 0;
  for (let index = 0; index < id.length; index += 1) value = (value * 31 + id.charCodeAt(index)) >>> 0;
  return `hsl(${value % 360} 76% 65%)`;
}

function renderPlayers(): void {
  playerCount.textContent = `${players.length} / 4`;
  playerList.replaceChildren();
  if (players.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Create or join a room to see players.";
    playerList.append(empty);
  } else {
    for (const player of players) {
      const item = document.createElement("li");
      item.className = "player-item";
      const color = document.createElement("span");
      color.className = "player-color";
      color.style.color = colorFor(player.id);
      color.style.backgroundColor = colorFor(player.id);
      const copy = document.createElement("div");
      copy.className = "player-copy";
      const name = document.createElement("div");
      name.className = "player-name";
      name.textContent = player.name;
      const state = document.createElement("div");
      state.className = "player-state";
      state.textContent = `${statusLabel(player.status)} · x ${Math.round(player.x * 100)}% · y ${Math.round(player.y * 100)}%`;
      copy.append(name, state);
      item.append(color, copy);
      if (player.isLocal) {
        const tag = document.createElement("span");
        tag.className = "local-tag";
        tag.textContent = "YOU";
        item.append(tag);
      }
      playerList.append(item);
    }
  }
  refreshRoomControls();
  drawPlayers();
}

function drawPlayers(): void {
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  for (const player of players) {
    const x = player.x * width;
    const y = player.y * height;
    const color = colorFor(player.id);
    context.globalAlpha = player.status === "disconnected" ? 0.42 : 1;
    context.beginPath();
    context.arc(x, y, player.isLocal ? 12 : 11, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 18;
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "#0d171d";
    context.font = "700 9px Manrope, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(players.indexOf(player) + 1), x, y);
    context.globalAlpha = 1;
    context.fillStyle = "#edf4f1";
    context.font = "600 12px Manrope, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(player.isLocal ? `${player.name} (you)` : player.name, x + 16, y - 8);
  }
}

network.on((event) => {
  if (event.type === "players") {
    players = event.players;
    renderPlayers();
  } else if (event.type === "status") {
    showStatus(event.message);
    refreshRoomControls();
  } else if (event.type === "error") {
    showStatus(event.message, true);
    refreshRoomControls();
  } else if (event.type === "room") {
    roomCodeDisplay.textContent = event.roomCode;
    roomDetails.hidden = false;
    refreshRoomControls();
  }
});

createButton.addEventListener("click", async () => {
  createButton.disabled = true;
  showStatus("Creating a room…");
  try {
    await network.createRoom();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true);
    refreshRoomControls();
  }
});

joinButton.addEventListener("click", async () => {
  const code = joinInput.value.trim().toUpperCase();
  if (!code) {
    showStatus("Enter a room code first.", true);
    joinInput.focus();
    return;
  }
  joinButton.disabled = true;
  showStatus("Looking up room and connecting…");
  try {
    await network.joinRoom(code);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true);
    refreshRoomControls();
  }
});

joinInput.addEventListener("input", () => {
  joinInput.value = joinInput.value.toUpperCase().replace(/\s/g, "");
});
joinInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinButton.click();
});

copyButton.addEventListener("click", async () => {
  const code = network.getRoomCode();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showStatus("Room code copied.");
  } catch {
    showStatus(`Copy this room code: ${code}`);
  }
});

lockButton.addEventListener("click", async () => {
  const nextAccepting = !network.isAcceptingJoins();
  lockButton.disabled = true;
  try {
    await network.setAcceptingJoins(nextAccepting);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    lockButton.disabled = false;
    refreshRoomControls();
  }
});

diagnosticsButton.addEventListener("click", async () => {
  diagnosticsButton.disabled = true;
  try {
    const peers = await network.getPeerDiagnostics();
    diagnostics.textContent = peers.length === 0 ? "No peer connections yet." : peers.map((peer) =>
      `${peer.name}: ${peer.connectionState}; data channel ${peer.dataChannelState}; candidates ${peer.localCandidateType ?? "unknown"} ↔ ${peer.remoteCandidateType ?? "unknown"}; sent ${peer.bytesSent} B / received ${peer.bytesReceived} B`,
    ).join("\n");
    diagnostics.hidden = false;
  } catch (error) {
    showStatus(`Could not read WebRTC diagnostics: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    diagnosticsButton.disabled = false;
  }
});

leaveButton.addEventListener("click", async () => {
  leaveButton.disabled = true;
  showStatus("Leaving room…");
  await network.leaveRoom();
  joinInput.value = "";
  showStatus("You left the room.");
  refreshRoomControls();
  leaveButton.disabled = false;
});

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  network.updatePosition((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
});

window.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement | null)?.tagName ?? "")) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    if (!pressedKeys.has(event.key)) {
      const own = players.find((player) => player.isLocal);
      if (own) {
        const dx = Number(event.key === "ArrowRight") - Number(event.key === "ArrowLeft");
        const dy = Number(event.key === "ArrowDown") - Number(event.key === "ArrowUp");
        network.updatePosition(own.x + dx * 0.02, own.y + dy * 0.02);
      }
    }
    pressedKeys.add(event.key);
  }
});
window.addEventListener("keyup", (event) => pressedKeys.delete(event.key));
window.addEventListener("blur", () => pressedKeys.clear());

let lastFrame = 0;
function animate(timestamp: number): void {
  const elapsed = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.05) : 0;
  lastFrame = timestamp;
  if (pressedKeys.size > 0) {
    const own = players.find((player) => player.isLocal);
    if (own) {
      const speed = 0.5 * elapsed;
      const dx = Number(pressedKeys.has("ArrowRight")) - Number(pressedKeys.has("ArrowLeft"));
      const dy = Number(pressedKeys.has("ArrowDown")) - Number(pressedKeys.has("ArrowUp"));
      if (dx || dy) network.updatePosition(own.x + dx * speed, own.y + dy * speed);
    }
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
