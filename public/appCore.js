const SESSION_KEY = "werewolfSession";
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
let detachSessionReplaced = null;
let detachRoomLifecycle = null;
let detachInteractionTimeout = null;
let pendingEntryResult = null;
let clientSessionActivationId = 0;
let clientRuntimePromise = null;

const $ = id => document.getElementById(id);
const setError = message => { $("room-error").textContent = message || ""; };

// ── Phase theming ──────────────────────────────────────────────────────────
const NIGHT_PHASES = [
  "night_start", "night_werewolf", "night_guard", "night_witch",
  "night_seer", "night_complete", "role_reveal",
];
const DAY_PHASES = ["day_announce", "day_vote", "day_pk", "day_result", "day_hunter"];

function setBodyPhase(phase) {
  document.body.classList.remove("phase-night", "phase-day");
  if (NIGHT_PHASES.includes(phase)) document.body.classList.add("phase-night");
  else if (DAY_PHASES.includes(phase)) document.body.classList.add("phase-day");
}

// ── Session ────────────────────────────────────────────────────────────────
function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (
      typeof session?.roomId !== "string" ||
      typeof session?.playerId !== "string" ||
      typeof session?.resumeToken !== "string"
    ) return null;
    return session;
  } catch {
    return null;
  }
}

function saveSession(result) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      roomId: result.roomId,
      playerId: result.playerId,
      resumeToken: result.resumeToken,
    }));
  } catch {
    setError("浏览器无法保存恢复凭证，刷新或关闭页面后将不能恢复身份。");
  }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* 当前连接仍可继续 */ }
}

function readSavedPlayerName() {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY)?.trim() || "").slice(0, 20);
  } catch {
    return "";
  }
}

function savePlayerName(name) {
  const normalized = name.trim().slice(0, 20);
  if (!normalized) return;
  savedPlayerName = normalized;
  currentPlayerName = normalized;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, normalized);
  } catch {
    setError("浏览器无法保存玩家名字，下次进入时需要重新设置。");
  }
  renderPlayerProfiles();
}

function renderPlayerProfiles() {
  const entryName = savedPlayerName || "新玩家";
  $("entry-welcome-text").textContent = savedPlayerName ? "欢迎回来，" : "欢迎你，";
  $("entry-player-name").textContent = entryName;
  $("room-player-name").textContent = currentPlayerName || entryName;
}

// ── Connection status ──────────────────────────────────────────────────────
function setConnectionStatus(message, kind = "") {
  $("connection-status").textContent = message;
  $("connection-status").className = `connection-status${kind ? ` ${kind}` : ""}`;
}

function vibrate(pattern = [300, 150, 300]) {
  if (!("vibrate" in navigator)) return false;
  return navigator.vibrate(pattern);
}

// ── Screen navigation ──────────────────────────────────────────────────────
function enterRoom(result) {
  currentRoomId = result.roomId;
  currentPlayerId = result.playerId;
  if (result.name) savePlayerName(result.name);
  membershipActive = true;
  sessionReplaced = false;
  $("entry").classList.add("hidden");
  $("room").classList.remove("hidden");
  $("room-id").textContent = currentRoomId;
  renderPlayerProfiles();
  showRoomScreen("management");
  setConnectionStatus("已连接");
}

function returnToEntry(message) {
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
  detachInteractionTimeout?.();
  detachInteractionTimeout = null;
  detachRoomLifecycle?.();
  detachRoomLifecycle = null;
  detachSessionReplaced?.();
  detachSessionReplaced = null;
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
      attachBrowserInteractionTimeoutEvents,
      attachBrowserRoomLifecycle,
      attachBrowserSessionLifecycle,
      attachBrowserSessionReplaced,
    } = await loadClientRuntime();
    if (myActivationId !== clientSessionActivationId) return;

    const session = createWebClientSession(socket);
    webClientSession = session;
    detachClientLifecycle = attachBrowserSessionLifecycle(session);
    detachSessionReplaced = attachBrowserSessionReplaced(session, payload => {
      if (payload.roomId !== currentRoomId || payload.playerId !== currentPlayerId) return;
      sessionReplaced = true;
      membershipActive = false;
      clearSession();
      teardownClientSession();
      setConnectionStatus("身份已在另一台设备恢复", "replaced");
      setError("你的身份已在另一台设备恢复，本设备连接已断开");
      $("prompt-overlay").classList.add("hidden");
    });
    detachRoomLifecycle = attachBrowserRoomLifecycle(session, {
      onRemoved(payload) {
        if (payload.roomId !== currentRoomId) return;
        clearSession();
        returnToEntry("你已被房主移出房间");
      },
      onClosed(payload) {
        if (payload.roomId !== currentRoomId) return;
        clearSession();
        returnToEntry("房主已关闭房间");
      },
    });
    detachInteractionTimeout = attachBrowserInteractionTimeoutEvents(session, {
      onState(payload) {
        handleInteractionTimeoutState(payload);
      },
      onError(payload) {
        handleInteractionTimeoutError(payload);
      },
    });
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
}

function emitWithAck(event, data, onSuccess, onFailure) {
  socket.timeout(5000).emit(event, data, (error, result) => {
    if (error) {
      const message = "服务器响应超时，请重试";
      setError(message);
      onFailure?.(message);
      return;
    }
    if (!result?.ok) {
      const message = result?.message || "操作失败，请重试";
      setError(message);
      onFailure?.(message);
      return;
    }
    setError("");
    onSuccess?.(result);
  });
}

// A command id represents one user intention, not one Socket.IO delivery.
// Retrying after a lost acknowledgement deliberately keeps the same id so the
// server can return the original result without repeating the game mutation.
function emitCommandWithAck(event, payload, onSuccess, onFailure) {
  const commandId = crypto.randomUUID();
  let attempts = 0;

  function send() {
    socket.timeout(5000).emit(event, { ...payload, commandId }, (error, result) => {
      if (error && attempts < 1) {
        attempts += 1;
        send();
        return;
      }
      if (error) {
        const message = "服务器响应超时，请重试";
        setError(message);
        onFailure?.(message);
        return;
      }
      if (!result?.ok) {
        const message = result?.message || "操作失败，请重试";
        setError(message);
        onFailure?.(message);
        return;
      }
      setError("");
      onSuccess?.(result);
    });
  }

  send();
}
