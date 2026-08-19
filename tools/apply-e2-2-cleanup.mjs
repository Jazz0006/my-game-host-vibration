import fs from "node:fs";

const path = "public/app.js";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  [
`const SESSION_KEY = "werewolfSession";
const PLAYER_NAME_KEY = "werewolfPlayerName";
const socket = io();
const gameViewIds = [
  "lobby-view", "role-view", "waiting-view", "night-start-view",
  "wolf-view", "witch-view", "seer-view", "seer-result-view",
  "guard-view", "hunter-view", "night-complete-view",
  "day-vote-view", "day-pk-view", "day-result-view",
  "spectator-view", "game-over-view",
];
let currentRoomId = "";
let currentPlayerId = "";
let isHost = false;
let activePromptId = "";
let currentGameState = null;
let membershipActive = false;
let resumeInProgress = false;
let sessionReplaced = false;
let currentRoomState = null;
let configCounts = {};
let configPlayerCount = 0;
let savedPlayerName = "";
let currentPlayerName = "";`,
`const SESSION_KEY = "werewolfSession";
const PLAYER_NAME_KEY = "werewolfPlayerName";
const CLIENT_RUNTIME_URL = "/client-runtime/client/browser/WebClientSession.js";
const socket = io({ autoConnect: false });
const gameViewIds = [
  "lobby-view", "role-view", "waiting-view", "night-start-view",
  "wolf-view", "witch-view", "seer-view", "seer-result-view",
  "guard-view", "hunter-view", "night-complete-view",
  "day-vote-view", "day-pk-view", "day-result-view",
  "spectator-view", "game-over-view",
];
let currentRoomId = "";
let currentPlayerId = "";
let isHost = false;
let activePromptId = "";
let currentGameState = null;
let membershipActive = false;
let resumeInProgress = false;
let sessionReplaced = false;
let currentRoomState = null;
let configCounts = {};
let configPlayerCount = 0;
let savedPlayerName = "";
let currentPlayerName = "";
let webClientSession = null;
let unsubscribeClientSession = null;
let detachClientLifecycle = null;
let pendingEntryResult = null;
let clientSessionActivationId = 0;
let clientRuntimePromise = null;`,
  ],
  [
`function returnToEntry(message) {
  currentRoomId = "";
  currentPlayerId = "";
  isHost = false;
  activePromptId = "";
  currentGameState = null;
  membershipActive = false;
  currentRoomState = null;
  configCounts = {};
  configPlayerCount = 0;
  document.body.classList.remove("phase-night", "phase-day");
  $("room").classList.add("hidden");
  $("prompt-overlay").classList.add("hidden");
  $("exit-room-dialog").classList.add("hidden");
  $("player-name-dialog").classList.add("hidden");
  $("entry").classList.remove("hidden");
  $("entry-error").textContent = message || "";
  renderPlayerProfiles();
}

function showRoomScreen(screen) {
  $("management-screen").classList.toggle("hidden", screen !== "management");
  $("config-screen").classList.toggle("hidden", screen !== "config");
  $("game-screen").classList.toggle("hidden", screen !== "game");
  $("room").dataset.screen = screen;
}

function resumeSession(session) {
  if (resumeInProgress || membershipActive || sessionReplaced) return;
  resumeInProgress = true;
  $("entry-error").textContent = "正在恢复上次房间……";
  socket.timeout(5000).emit("player:resume", session, (error, result) => {
    resumeInProgress = false;
    if (error) return $("entry-error").textContent = "连接服务器超时，正在重试……";
    if (!result?.ok) {
      clearSession();
      returnToEntry(result?.message || "无法恢复上次房间，请重新加入");
      return;
    }
    $("entry-error").textContent = "";
    enterRoom(result);
  });
}`,
`function returnToEntry(message) {
  clientSessionActivationId += 1;
  teardownClientSession();
  currentRoomId = "";
  currentPlayerId = "";
  isHost = false;
  activePromptId = "";
  currentGameState = null;
  membershipActive = false;
  resumeInProgress = false;
  currentRoomState = null;
  configCounts = {};
  configPlayerCount = 0;
  document.body.classList.remove("phase-night", "phase-day");
  $("room").classList.add("hidden");
  $("prompt-overlay").classList.add("hidden");
  $("exit-room-dialog").classList.add("hidden");
  $("player-name-dialog").classList.add("hidden");
  $("entry").classList.remove("hidden");
  $("entry-error").textContent = message || "";
  renderPlayerProfiles();
  queueMicrotask(() => {
    if (!socket.connected) socket.connect();
  });
}

function showRoomScreen(screen) {
  $("management-screen").classList.toggle("hidden", screen !== "management");
  $("config-screen").classList.toggle("hidden", screen !== "config");
  $("game-screen").classList.toggle("hidden", screen !== "game");
  $("room").dataset.screen = screen;
}

function loadClientRuntime() {
  if (!clientRuntimePromise) clientRuntimePromise = import(CLIENT_RUNTIME_URL);
  return clientRuntimePromise;
}

function activeCredentials(value) {
  if (!value || typeof value !== "object") return null;
  const roomId = typeof value.roomId === "string" ? value.roomId.trim() : "";
  const playerId = typeof value.playerId === "string" ? value.playerId.trim() : "";
  let resumeToken = typeof value.resumeToken === "string" ? value.resumeToken.trim() : "";

  if (!resumeToken && roomId && playerId) {
    const saved = readSession();
    if (saved?.roomId === roomId && saved?.playerId === playerId) {
      resumeToken = saved.resumeToken;
    }
  }

  return roomId && playerId && resumeToken
    ? { roomId, playerId, resumeToken }
    : null;
}

function roomIsVisible() {
  return !$("room").classList.contains("hidden");
}

function teardownClientSession() {
  const session = webClientSession;
  webClientSession = null;
  detachClientLifecycle?.();
  detachClientLifecycle = null;
  unsubscribeClientSession?.();
  unsubscribeClientSession = null;
  pendingEntryResult = null;
  if (session?.getConnectionState().status !== "Disposed") session?.dispose();
}

function renderClientSessionSnapshot(session, snapshot) {
  if (session !== webClientSession) return;

  const status = snapshot.connection.status;
  if (status === "Connecting") {
    membershipActive = false;
    setConnectionStatus("连接中……", "reconnecting");
    return;
  }

  if (status === "Syncing") {
    membershipActive = false;
    setConnectionStatus("正在同步游戏状态……", "reconnecting");
    return;
  }

  if (status === "Connected") {
    membershipActive = true;
    resumeInProgress = false;
    sessionReplaced = false;
    $("entry-error").textContent = "";
    setError("");

    if (!roomIsVisible()) {
      enterRoom(pendingEntryResult || {
        roomId: currentRoomId,
        playerId: currentPlayerId,
      });
    } else {
      setConnectionStatus("已连接");
    }
    pendingEntryResult = null;

    const playerView = snapshot.authoritativeState.envelope?.payload;
    if (playerView && typeof playerView === "object") renderGameState(playerView);
    return;
  }

  if (status === "Disconnected") {
    membershipActive = false;
    if (sessionReplaced) return;
    if (currentRoomId) {
      setConnectionStatus("网络连接中……", "reconnecting");
      setError("连接暂时中断，正在恢复身份并同步当前游戏状态");
    }
    queueMicrotask(() => {
      if (
        session === webClientSession &&
        session.getConnectionState().status === "Disconnected"
      ) {
        session.reconnect();
      }
    });
    return;
  }

  if (status === "Reconnecting") {
    membershipActive = false;
    setConnectionStatus("网络连接中……", "reconnecting");
    return;
  }

  if (status === "Failed") {
    membershipActive = false;
    resumeInProgress = false;
    const message = snapshot.connection.failure?.message || "无法同步当前游戏状态，请刷新后重试";
    setConnectionStatus("同步失败", "error");

    if (!roomIsVisible()) {
      clearSession();
      returnToEntry(message);
    } else {
      setError(message);
    }
  }
}

async function activateClientSession(result) {
  const credentials = activeCredentials(result);
  if (!credentials) {
    clearSession();
    returnToEntry("缺少身份恢复凭证，请重新加入房间");
    return;
  }

  const myActivationId = ++clientSessionActivationId;
  if (webClientSession) teardownClientSession();

  currentRoomId = credentials.roomId;
  currentPlayerId = credentials.playerId;
  pendingEntryResult = {
    ...result,
    roomId: credentials.roomId,
    playerId: credentials.playerId,
  };

  try {
    const {
      createWebClientSession,
      attachBrowserSessionLifecycle,
    } = await loadClientRuntime();
    if (myActivationId !== clientSessionActivationId) return;

    const session = createWebClientSession(socket);
    webClientSession = session;
    detachClientLifecycle = attachBrowserSessionLifecycle(session);
    unsubscribeClientSession = session.subscribe(snapshot => {
      renderClientSessionSnapshot(session, snapshot);
    });
    session.start(credentials);
  } catch (error) {
    if (myActivationId !== clientSessionActivationId) return;
    resumeInProgress = false;
    const message = error instanceof Error && error.message
      ? error.message
      : "客户端运行时加载失败，请刷新后重试";
    clearSession();
    returnToEntry(message);
  }
}

function resumeSession(session) {
  if (resumeInProgress || membershipActive || sessionReplaced) return;
  resumeInProgress = true;
  $("entry-error").textContent = "正在恢复上次房间并同步状态……";
  void activateClientSession(session);
}`,
  ],
  [
`    saveSession(result);
    enterRoom(result);
  });
});

$("join-room").addEventListener("click", () => {
  socket.emit("player:join-room", {
    roomId: $("room-input").value,
    name: savedPlayerName || undefined,
  }, result => {
    if (!result?.ok) return $("entry-error").textContent = result?.message || "加入失败";
    saveSession(result);
    enterRoom(result);
  });
});`,
`    saveSession(result);
    activateClientSession(result);
  });
});

$("join-room").addEventListener("click", () => {
  socket.emit("player:join-room", {
    roomId: $("room-input").value,
    name: savedPlayerName || undefined,
  }, result => {
    if (!result?.ok) return $("entry-error").textContent = result?.message || "加入失败";
    saveSession(result);
    activateClientSession(result);
  });
});`,
  ],
  [
`// ── Socket connection ──────────────────────────────────────────────────────
socket.on("connect", () => {
  setConnectionStatus("已连接");
  const session = readSession();
  if (!membershipActive && session && !sessionReplaced) resumeSession(session);
});

socket.on("disconnect", reason => {
  membershipActive = false;
  if (reason === "io server disconnect" && sessionReplaced) return;
  if (currentRoomId) {
    setConnectionStatus("网络连接中……", "reconnecting");
    setError("连接暂时中断，恢复网络后会自动回到当前身份和操作界面");
  }
});

socket.on("connect_error", () => {
  if (!currentRoomId && readSession()) $("entry-error").textContent = "正在等待服务器以恢复上次房间……";
});

socket.on("session:replaced", () => {
  sessionReplaced = true;
  membershipActive = false;
  clearSession();
  setConnectionStatus("身份已在另一台设备恢复", "replaced");
  setError("你的身份已在另一台设备恢复，本设备连接已断开");
  $("prompt-overlay").classList.add("hidden");
});`,
`// ── Socket session events ──────────────────────────────────────────────────
socket.on("session:replaced", () => {
  sessionReplaced = true;
  membershipActive = false;
  clearSession();
  teardownClientSession();
  setConnectionStatus("身份已在另一台设备恢复", "replaced");
  setError("你的身份已在另一台设备恢复，本设备连接已断开");
  $("prompt-overlay").classList.add("hidden");
});`,
  ],
  [
`socket.on("room:state", state => {
  if (state.roomId !== currentRoomId) return;
  membershipActive = true;
  currentRoomState = state;
  setConnectionStatus("已连接");
  setError("");
  isHost = state.viewer.playerId === currentPlayerId && state.viewer.isHost;`,
`socket.on("room:state", state => {
  if (state.roomId !== currentRoomId) return;
  currentRoomState = state;
  isHost = state.viewer.playerId === currentPlayerId && state.viewer.isHost;`,
  ],
  [
`// ── Game events ────────────────────────────────────────────────────────────
socket.on("player:game-state", renderGameState);
socket.on("player:action-alert", () => vibrate([300, 150, 300]));`,
`// ── Game events ────────────────────────────────────────────────────────────
// Authoritative private PlayerView now arrives through ClientSession/client:state.
socket.on("player:action-alert", () => vibrate([300, 150, 300]));`,
  ],
  [
`savedPlayerName = readSavedPlayerName();
currentPlayerName = savedPlayerName;
renderPlayerProfiles();`,
`savedPlayerName = readSavedPlayerName();
currentPlayerName = savedPlayerName;
renderPlayerProfiles();

const initialSession = readSession();
if (initialSession && !sessionReplaced) {
  resumeSession(initialSession);
} else {
  socket.connect();
}`,
  ],
];

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

for (let index = 0; index < replacements.length; index += 1) {
  const [before, after] = replacements[index];
  const count = countOccurrences(source, before);
  if (count !== 1) {
    console.error(`ABORT: replacement ${index + 1} expected exactly 1 match, found ${count}.`);
    console.error("No file was written.");
    process.exit(1);
  }
  source = source.replace(before, after);
}

fs.writeFileSync(path, source, "utf8");
console.log(`Updated ${path} successfully (${replacements.length} guarded replacements).`);
console.log("Next: git diff --check && npm run typecheck && npm test");
