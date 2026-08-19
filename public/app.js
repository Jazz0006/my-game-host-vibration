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
let unsubscribeClientRealtimeEvents = null;
let detachClientLifecycle = null;
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
  detachClientLifecycle?.();
  detachClientLifecycle = null;
  unsubscribeClientRealtimeEvents?.();
  unsubscribeClientRealtimeEvents = null;
  unsubscribeClientSession?.();
  unsubscribeClientSession = null;
  pendingEntryResult = null;
  if (session?.getConnectionState().status !== "Disposed") session?.dispose();
}

function handleSessionReplaced(session, event, eventType) {
  if (session !== webClientSession || event?.type !== eventType) return;
  if (
    event.payload?.roomId !== currentRoomId ||
    event.payload?.playerId !== currentPlayerId
  ) return;

  sessionReplaced = true;
  membershipActive = false;
  clearSession();
  teardownClientSession();
  setConnectionStatus("身份已在另一台设备恢复", "replaced");
  setError("你的身份已在另一台设备恢复，本设备连接已断开");
  $("prompt-overlay").classList.add("hidden");
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
      CLIENT_SESSION_REPLACED,
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
    unsubscribeClientRealtimeEvents = session.subscribeRealtimeEvents(event => {
      handleSessionReplaced(session, event, CLIENT_SESSION_REPLACED);
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

// ── Entry screen tabs ──────────────────────────────────────────────────────
function showEntryTab(tab) {
  const isHost = tab === "host";
  $("tab-host").classList.toggle("active", isHost);
  $("tab-join").classList.toggle("active", !isHost);
  $("form-host").classList.toggle("hidden", !isHost);
  $("form-join").classList.toggle("hidden", isHost);
}

$("tab-host").addEventListener("click", () => showEntryTab("host"));
$("tab-join").addEventListener("click", () => showEntryTab("join"));

// ── Game view switcher ─────────────────────────────────────────────────────
function showGameView(id) {
  for (const viewId of gameViewIds) $(viewId).classList.toggle("hidden", viewId !== id);
}

function playerButton(player, onClick, className = "") {
  const button = document.createElement("button");
  button.textContent = `${player.seat}号 ${player.name}`;
  button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function renderTargets(containerId, targets, onSelect, className = "") {
  $(containerId).replaceChildren(...targets.map(player =>
    playerButton(player, () => onSelect(player), className)
  ));
}

// ── Game state rendering ───────────────────────────────────────────────────
function renderGameState(state) {
  currentGameState = state;
  setBodyPhase(state.phase);

  if (state.mode === "lobby") return showGameView("lobby-view");
  showRoomScreen("game");

  if (state.roleName) {
    $("role-name").textContent = state.roleName;
    $("role-description").textContent = state.roleDescription;
    $("waiting-role").textContent = "需要时可点击右上角再次查看身份";
    $("peek-role").classList.toggle("hidden", state.mode === "role_reveal");
  }

  if (state.mode === "role_reveal") {
    const isWolf = state.roleName === "狼人";
    $("role-view").dataset.roleType = isWolf ? "wolf" : "good";
    return showGameView("role-view");
  }

  if (state.mode === "waiting") return showGameView("waiting-view");

  if (state.mode === "wolf_action") {
    showGameView("wolf-view");
    renderTargets("wolf-targets", state.targets, target => {
      if (!confirm(`确定击杀 ${target.seat}号 ${target.name}？提交后不能修改。`)) return;
      emitCommandWithAck("player:submit-wolf-target", {
        actionId: state.actionId,
        targetPlayerId: target.id,
      });
    }, "danger");
    return;
  }

  if (state.mode === "witch_action") {
    showGameView("witch-view");
    $("poison-picker").classList.add("hidden");
    $("use-antidote").classList.toggle("hidden", !state.antidoteAvailable);
    $("show-poison").classList.toggle("hidden", !state.poisonAvailable);
    $("use-no-potion").classList.remove("hidden");
    const attacked = state.attackedPlayer;
    $("attacked-player").textContent = attacked
      ? `今晚 ${attacked.seat}号 ${attacked.name} 被狼人袭击`
      : "今晚没有玩家被狼人袭击";
    renderTargets("poison-targets", state.poisonTargets, target => {
      if (!confirm(`确定使用毒药毒杀 ${target.seat}号 ${target.name}？`)) return;
      emitCommandWithAck("player:submit-witch-action", {
        actionId: state.actionId,
        useAntidote: false,
        poisonTargetId: target.id,
      });
    }, "danger");
    return;
  }

  if (state.mode === "seer_action") {
    showGameView("seer-view");
    renderTargets("seer-targets", state.targets, target => {
      if (!confirm(`确定查验 ${target.seat}号 ${target.name}？`)) return;
      emitCommandWithAck("player:submit-seer-target", {
        actionId: state.actionId,
        targetPlayerId: target.id,
      });
    });
    return;
  }

  if (state.mode === "seer_result") {
    showGameView("seer-result-view");
    const isWolf = state.checkedAlignment === "werewolf";
    $("seer-result").className = `result ${isWolf ? "werewolf" : "good"}`;
    $("seer-result").textContent = `${state.checkedPlayer.seat}号 ${state.checkedPlayer.name} 是${isWolf ? "狼人" : "好人"}`;
    return;
  }

  if (state.mode === "guard_action") {
    showGameView("guard-view");
    renderTargets("guard-targets", state.targets, target => {
      if (!confirm(`确定保护 ${target.seat}号 ${target.name}？`)) return;
      emitCommandWithAck("player:submit-guard-target", {
        actionId: state.actionId,
        targetPlayerId: target.id,
      });
    });
    return;
  }

  if (state.mode === "hunter_execution") {
    showGameView("hunter-view");
    renderTargets("hunter-targets", state.targets, target => {
      if (!confirm(`确定带走 ${target.seat}号 ${target.name}？`)) return;
      emitCommandWithAck("player:submit-hunter-execution", {
        actionId: state.actionId,
        targetPlayerId: target.id,
      });
    }, "danger");
    return;
  }

  if (state.mode === "night_start") {
    showGameView("night-start-view");
    $("night-start-role").textContent = "需要时可点击右上角再次查看身份";
    return;
  }

  if (state.mode === "night_complete") {
    showGameView("night-complete-view");
    $("night-next-status").textContent = "正在进入白天投票……";
    $("night-deaths").textContent = state.deaths?.length
      ? `昨夜死亡：${state.deaths.map(p => `${p.seat}号 ${p.name}`).join("、")}`
      : "昨夜是平安夜，没有玩家死亡";
    return;
  }

  if (state.mode === "day_announce") {
    showGameView("night-complete-view");
    $("night-deaths").textContent = state.deaths?.length
      ? `昨夜死亡：${state.deaths.map(p => `${p.seat}号 ${p.name}`).join("、")}`
      : "昨夜是平安夜，没有玩家死亡";
    $("night-next-status").textContent = "猎人正在决定是否开枪……";
    return;
  }

  function deathSummary(deaths) {
    return deaths?.length
      ? `昨夜死亡：${deaths.map(p => `${p.seat}号 ${p.name}`).join("、")}`
      : "昨夜是平安夜，没有玩家死亡";
  }

  if (state.mode === "day_vote") {
    showGameView("day-vote-view");
    $("day-vote-deaths").textContent = deathSummary(state.deaths);
    if (state.myVote) {
      $("vote-targets").replaceChildren();
      $("vote-submitted").classList.remove("hidden");
    } else {
      $("vote-submitted").classList.add("hidden");
      renderTargets("vote-targets", state.targets, target => {
        if (!confirm(`确定投票放逐 ${target.seat}号 ${target.name}？`)) return;
        emitCommandWithAck("player:submit-vote", { actionId: state.actionId, targetId: target.id });
      }, "danger");
    }
    return;
  }

  if (state.mode === "day_pk") {
    showGameView("day-pk-view");
    $("pk-deaths").textContent = deathSummary(state.deaths);
    if (state.myVote) {
      $("pk-targets").replaceChildren();
      $("pk-submitted").classList.remove("hidden");
    } else {
      $("pk-submitted").classList.add("hidden");
      renderTargets("pk-targets", state.targets, target => {
        if (!confirm(`确定投票放逐 ${target.seat}号 ${target.name}？`)) return;
        emitCommandWithAck("player:submit-vote", { actionId: state.actionId, targetId: target.id });
      }, "danger");
    }
    return;
  }

  if (state.mode === "day_result") {
    showGameView("day-result-view");
    $("day-result-deaths").textContent = deathSummary(state.deaths);
    $("day-result-elimination").textContent = state.noKill
      ? "本轮平票，无人出局。"
      : state.eliminatedPlayer
        ? `${state.eliminatedPlayer.seat}号 ${state.eliminatedPlayer.name} 被放逐出局。`
        : "";
    return;
  }

  if (state.mode === "spectator") {
    showGameView("spectator-view");
    $("spectator-deaths").textContent = deathSummary(state.deaths);
    return;
  }

  if (state.mode === "game_over") {
    showGameView("game-over-view");
    const isWolf = state.winner === "wolf";
    $("game-over-icon").textContent = isWolf ? "🐺" : "🌟";
    const title = $("game-over-title");
    title.textContent = isWolf ? "狼人胜利！" : "好人胜利！";
    title.className = `action-title game-over-title ${isWolf ? "wolf-win" : "good-win"}`;
    $("game-over-message").textContent = isWolf
      ? "狼人成功控制了村庄。"
      : "所有狼人已被放逐，村庄恢复平静。";
    return;
  }
}

// ── Entry actions ──────────────────────────────────────────────────────────
$("create-room").addEventListener("click", () => {
  socket.emit("host:create-room", { name: savedPlayerName || undefined }, result => {
    if (!result?.ok) return $("entry-error").textContent = result?.message || "创建失败";
    saveSession(result);
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
});

// ── Room state ─────────────────────────────────────────────────────────────
const roleIcons = { werewolf: "🐺", seer: "◉", witch: "⚗", guard: "♢", hunter: "⌖", villager: "●" };

function defaultSeatPosition(index, total) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(total, 1);
  return { x: 0.5 + Math.cos(angle) * 0.39, y: 0.5 + Math.sin(angle) * 0.36 };
}

function rectangularSideCounts(count) {
  const layouts = {
    9: [3, 2, 2, 2],
    10: [3, 2, 3, 2],
    11: [3, 3, 3, 2],
    12: [4, 2, 4, 2],
  };
  return layouts[count] || [4, 3, 4, Math.max(2, count - 11)];
}

function rectangularSeatPosition(index, total) {
  const [topCount, rightCount, bottomCount, leftCount] = rectangularSideCounts(total);
  let remaining = index;
  if (remaining < topCount) {
    return { x: 0.13 + 0.74 * (remaining + 1) / (topCount + 1), y: 0.12 };
  }
  remaining -= topCount;
  if (remaining < rightCount) {
    return { x: 0.89, y: 0.12 + 0.76 * (remaining + 1) / (rightCount + 1) };
  }
  remaining -= rightCount;
  if (remaining < bottomCount) {
    return { x: 0.87 - 0.74 * (remaining + 1) / (bottomCount + 1), y: 0.88 };
  }
  remaining -= bottomCount;
  return { x: 0.11, y: 0.88 - 0.76 * (remaining + 1) / (leftCount + 1) };
}

function seatPosition(index, total) {
  return total > 8
    ? rectangularSeatPosition(index, total)
    : defaultSeatPosition(index, total);
}

function insertMarkerPosition(insertIndex, total) {
  if (total === 0) return { x: 0.5, y: 0.5 };
  if (total <= 8) {
    const angle = -Math.PI / 2 + Math.PI * 2 * (insertIndex - 0.5) / total;
    return { x: 0.5 + Math.cos(angle) * 0.39, y: 0.5 + Math.sin(angle) * 0.36 };
  }
  const current = seatPosition(insertIndex === total ? 0 : insertIndex, total);
  const previous = seatPosition((insertIndex - 1 + total) % total, total);
  return { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
}

function nearestInsertIndex(point, total, rect) {
  if (total <= 8) {
    const angle = Math.atan2(
      (point.y - 0.5) * rect.height,
      (point.x - 0.5) * rect.width,
    );
    const normalized = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    return Math.max(0, Math.min(total, Math.round(normalized / (Math.PI * 2) * total));
  }
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= total; index += 1) {
    const marker = insertMarkerPosition(index, total);
    const distance = Math.hypot(
      (marker.x - point.x) * rect.width,
      (marker.y - point.y) * rect.height,
    );
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function insertIndexChangesOrder(insertIndex, originalIndex) {
  const adjustedIndex = insertIndex > originalIndex ? insertIndex - 1 : insertIndex;
  return adjustedIndex !== originalIndex;
}

function previewSeatIndex(index, draggedIndex, insertIndex) {
  const adjustedIndex = insertIndex > draggedIndex ? insertIndex - 1 : insertIndex;
  if (index === draggedIndex) return adjustedIndex;
  const indexAfterRemoval = index > draggedIndex ? index - 1 : index;
  return indexAfterRemoval >= adjustedIndex ? indexAfterRemoval + 1 : indexAfterRemoval;
}

function setSeatNodePosition(node, position) {
  node.style.left = `${position.x * 100}%`;
  node.style.top = `${position.y * 100}%`;
}

function makeSeatNode(player, index, total) {
  const node = document.createElement("div");
  node.className = `seat-player${isHost ? " movable" : ""}${player.connected ? "" : " offline"}${player.id === currentPlayerId ? " self" : ""}`;
  setSeatNodePosition(node, seatPosition(index, total));
  node.innerHTML = `<span class="seat-number">${player.seat}</span><span class="seat-player-name"></span>`;
  node.querySelector(".seat-player-name").textContent = player.name;
  node.title = isHost ? "长按并拖动调整座位顺序" : `${player.seat}号 ${player.name}`;
  node.setAttribute("aria-label", `${player.seat}号 ${player.name}${player.isHost ? "，房主" : ""}`);
  return node;
}

function enableSeatReordering(players, nodes) {
  const map = $("seat-map");
  const marker = document.createElement("div");
  marker.className = "seat-insert-marker hidden";
  marker.textContent = "+";
  map.append(marker);

  function resetPreview() {
    nodes.forEach((node, index) => setSeatNodePosition(node, seatPosition(index, players.length)));
    marker.classList.add("hidden");
  }

  nodes.forEach((node, draggedIndex) => {
    let holdTimer = 0;
    let dragging = false;
    let insertIndex = null;
    let startPoint = null;

    function pointFromEvent(event) {
      const rect = map.getBoundingClientRect();
      return {
        rect,
        point: {
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        },
      };
    }

    function beginDrag(event) {
      dragging = true;
      node.classList.add("dragging");
      map.classList.add("reordering");
      updateDrag(event);
    }

    function updateDrag(event) {
      if (!dragging) return;
      const { rect, point } = pointFromEvent(event);
      setSeatNodePosition(node, point);
      const insideMap = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
      insertIndex = insideMap ? nearestInsertIndex(point, players.length, rect) : null;
      if (insertIndex === null || !insertIndexChangesOrder(insertIndex, draggedIndex)) {
        nodes.forEach((otherNode, index) => {
          if (index !== draggedIndex) setSeatNodePosition(otherNode, seatPosition(index, players.length));
        });
        marker.classList.add("hidden");
        return;
      }

      nodes.forEach((otherNode, index) => {
        if (index === draggedIndex) return;
        setSeatNodePosition(
          otherNode,
          seatPosition(previewSeatIndex(index, draggedIndex, insertIndex), players.length),
        );
      });
      setSeatNodePosition(marker, insertMarkerPosition(insertIndex, players.length));
      marker.classList.remove("hidden");
    }

    function finishDrag(event, cancelled = false) {
      window.clearTimeout(holdTimer);
      if (!dragging) return;
      const destination = insertIndex;
      dragging = false;
      if (event && node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      node.classList.remove("dragging");
      map.classList.remove("reordering");
      insertIndex = null;
      resetPreview();
      if (!cancelled && destination !== null && insertIndexChangesOrder(destination, draggedIndex)) {
        emitWithAck("host:move-player-seat", {
          targetPlayerId: players[draggedIndex].id,
          insertIndex: destination,
        });
      }
    }

    node.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch" && event.button !== 0) return;
      startPoint = { x: event.clientX, y: event.clientY };
      node.setPointerCapture(event.pointerId);
      if (event.pointerType !== "touch") {
        event.preventDefault();
        beginDrag(event);
      } else {
        holdTimer = window.setTimeout(() => beginDrag(event), 260);
      }
    });
    node.addEventListener("pointermove", event => {
      if (event.pointerType === "touch" && !dragging && startPoint && Math.hypot(
        event.clientX - startPoint.x,
        event.clientY - startPoint.y,
      ) > 10) {
        window.clearTimeout(holdTimer);
      }
      updateDrag(event);
    });
    node.addEventListener("pointerup", event => finishDrag(event));
    node.addEventListener("pointercancel", event => finishDrag(event, true));
    node.addEventListener("lostpointercapture", () => {
      if (dragging) finishDrag(null, true);
      else window.clearTimeout(holdTimer);
    });
  });
}

function renderManagement(state) {
  const orderedPlayers = [...state.players].sort((left, right) => left.seat - right.seat);
  const center = document.createElement("div");
  center.className = "table-center";
  center.innerHTML = `<span>游戏桌</span><small>${orderedPlayers.length} 人已入座</small>`;
  const seatNodes = orderedPlayers.map((player, index) => makeSeatNode(player, index, orderedPlayers.length));
  $("seat-map").classList.toggle("rectangular", orderedPlayers.length > 8);
  $("seat-map").replaceChildren(center, ...seatNodes);
  if (isHost) enableSeatReordering(orderedPlayers, seatNodes);
  $("player-count").textContent = `${state.players.filter(player => player.connected).length}/${state.players.length} 在线`;
  $("seat-hint").textContent = isHost ? "拖动头像调整顺序（手机请长按）" : "座位由房主按照现场顺序排列";

  $("players").replaceChildren(...orderedPlayers.map(player => {
    const row = document.createElement("div");
    row.className = "player compact-player";
    const identity = document.createElement("div");
    identity.className = "compact-player-identity";
    identity.innerHTML = `<span class="seat">${player.seat}</span><span class="player-name-label"></span>`;
    identity.querySelector(".player-name-label").textContent = `${player.name}${player.isHost ? " · 房主" : ""}${player.connected ? "" : " · 离线"}`;
    row.append(identity);
    if (isHost && player.id !== currentPlayerId) {
      const actions = document.createElement("span");
      actions.className = "player-actions";
      const transfer = document.createElement("button");
      transfer.className = "secondary";
      transfer.textContent = "设为房主";
      transfer.disabled = !player.connected;
      transfer.addEventListener("click", () => {
        if (confirm(`确定将房主转让给 ${player.seat}号 ${player.name}？`)) {
          emitWithAck("host:transfer-host", { targetPlayerId: player.id });
        }
      });
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "移除";
      remove.addEventListener("click", () => {
        if (confirm(`确定将 ${player.seat}号 ${player.name} 移出房间？`)) {
          emitWithAck("host:remove-player", { targetPlayerId: player.id });
        }
      });
      actions.append(transfer, remove);
      row.append(actions);
    }
    return row;
  }));

  $("open-config").classList.toggle("hidden", !isHost);
  $("open-config").disabled = !state.game.canStart;
  $("open-config").textContent = state.game.canStart
    ? "进入游戏配置"
    : `等待玩家（至少 ${state.game.minPlayers} 人且全部在线）`;
  $("leave-room").textContent = "退出房间";
  $("leave-room").title = "";
  $("dev-tools").classList.toggle("hidden", !isHost);

  const select = $("target-player");
  const selected = select.value;
  const candidates = state.players.filter(player => !player.isHost && player.connected);
  select.replaceChildren(...candidates.map(player => new Option(`${player.seat}号 ${player.name}`, player.id)));
  if (candidates.some(player => player.id === selected)) select.value = selected;
  $("send-prompt").disabled = candidates.length === 0;
  if (state.testPrompt) {
    const target = state.players.find(player => player.id === state.testPrompt.targetPlayerId);
    const labels = {
      sent: "已发送，等待玩家确认",
      acknowledged: "玩家已确认，等待提交",
      submitted: `玩家已提交：${state.testPrompt.choice}`,
    };
    $("prompt-status").textContent = `${target?.seat || "?"}号 ${target?.name || "玩家"}：${labels[state.testPrompt.status]}`;
  }
}

function loadDefaultConfig(state) {
  configPlayerCount = state.players.length;
  configCounts = Object.fromEntries(state.roleCatalog.map(role => [role.id, 0]));
  for (const role of state.defaultRoleDeck) configCounts[role] = (configCounts[role] || 0) + 1;
  renderRoleConfig(state);
}

function configValidation() {
  const total = Object.values(configCounts).reduce((sum, value) => sum + value, 0);
  const wolves = configCounts.werewolf || 0;
  const good = total - wolves;
  if (total !== configPlayerCount) return {
    ok: false,
    message: total < configPlayerCount
      ? `还需配置 ${configPlayerCount - total} 个身份`
      : `多配置了 ${total - configPlayerCount} 个身份`,
    total, wolves, good,
  };
  if (wolves < 1) return { ok: false, message: "至少需要一名狼人", total, wolves, good };
  if (wolves >= good) return { ok: false, message: "开局时狼人数量必须少于好人", total, wolves, good };
  return { ok: true, message: "配置有效，可以发送身份", total, wolves, good };
}

function renderRoleConfig(state) {
  $("config-player-count").textContent = configPlayerCount;
  $("role-config-list").replaceChildren(...state.roleCatalog.map(role => {
    const row = document.createElement("article");
    row.className = "role-config-row";
    row.innerHTML = `<span class="role-config-icon">${roleIcons[role.id] || "◇"}</span><span class="role-config-name"></span>`;
    row.querySelector(".role-config-name").textContent = role.name;
    const stepper = document.createElement("div");
    stepper.className = "role-stepper";
    const minus = document.createElement("button");
    minus.className = "secondary";
    minus.textContent = "−";
    minus.disabled = (configCounts[role.id] || 0) === 0;
    const value = document.createElement("strong");
    value.textContent = configCounts[role.id] || 0;
    const plus = document.createElement("button");
    plus.className = "secondary";
    plus.textContent = "+";
    const specialRole = !["werewolf", "villager"].includes(role.id);
    plus.disabled = specialRole && (configCounts[role.id] || 0) >= 1;
    minus.addEventListener("click", () => { configCounts[role.id] -= 1; renderRoleConfig(state); });
    plus.addEventListener("click", () => { configCounts[role.id] += 1; renderRoleConfig(state); });
    stepper.append(minus, value, plus);
    row.append(stepper);
    return row;
  }));
  const validation = configValidation();
  $("config-summary").className = `config-summary ${validation.ok ? "valid" : "invalid"}`;
  $("config-summary").innerHTML = `<strong>${validation.total}/${configPlayerCount}</strong><span>狼人 ${validation.wolves} · 好人 ${validation.good}</span><small>${validation.message}</small>`;
  $("deal-roles").disabled = !validation.ok;
}

function renderHostGameControls(state) {
  const game = state.game;
  $("game-host-controls").classList.toggle("hidden", !isHost);
  const inVote = game.phase === "day_vote" || game.phase === "day_pk";
  $("start-night").classList.toggle("hidden", game.phase !== "night_start");
  $("close-voting").classList.toggle("hidden", !inVote);
  $("vote-tally").classList.toggle("hidden", !inVote && game.phase !== "day_result");
  $("begin-night-start").classList.toggle("hidden", game.phase !== "day_result");
  $("restart-game").classList.toggle("hidden", game.phase !== "game_over");
  if (inVote || game.phase === "day_result") {
    $("vote-tally").textContent = game.voteTally
      ? Object.entries(game.voteTally).map(([id, count]) => {
          const player = state.players.find(item => item.id === id);
          return `${player?.seat || "?"}号 ${player?.name || ""}：${count}票`;
        }).join("　")
      : `已投票：${game.votesCast || 0}/${game.votesRequired || 0}人`;
  }
  const labels = {
    role_reveal: `等待确认身份（${game.confirmedRoles}/${state.players.length}）`,
    night_start: `第 ${game.nightNumber} 夜 · 等待开始`,
    night_werewolf: `第 ${game.nightNumber} 夜 · 狼人行动`,
    night_guard: `第 ${game.nightNumber} 夜 · 守卫行动`,
    night_witch: `第 ${game.nightNumber} 夜 · 女巫行动`,
    night_seer: `第 ${game.nightNumber} 夜 · 预言家行动`,
    night_complete: `第 ${game.nightNumber} 夜结束`,
    day_vote: `第 ${game.dayNumber} 天 · 投票 ${game.votesCast || 0}/${game.votesRequired || 0}`,
    day_pk: `第 ${game.dayNumber} 天 · 平票重投`,
    day_result: `第 ${game.dayNumber} 天 · 结果`,
    day_hunter: "猎人技能触发",
    game_over: `游戏结束 · ${game.winner === "wolf" ? "狼人胜利" : "好人胜利"}`,
  };
  $("game-progress").textContent = labels[game.phase] || "游戏进行中";
}

socket.on("room:state", state => {
  if (state.roomId !== currentRoomId) return;
  currentRoomState = state;
  isHost = state.viewer.playerId === currentPlayerId && state.viewer.isHost;
  const viewer = state.players.find(player => player.id === currentPlayerId);
  if (viewer?.name && viewer.name !== currentPlayerName) savePlayerName(viewer.name);

  if (state.game.phase === "lobby") {
    if ($("room").dataset.screen === "game") showRoomScreen("management");
    if (!isHost && $("room").dataset.screen === "config") showRoomScreen("management");
    if ($("room").dataset.screen === "config" && configPlayerCount !== state.players.length) loadDefaultConfig(state);
    renderManagement(state);
  } else {
    showRoomScreen("game");
    renderHostGameControls(state);
  }
});

// ── Game events ────────────────────────────────────────────────────────────
// Authoritative private PlayerView and migrated lifecycle effects now arrive
// through ClientSession/client:state and ClientSession/client:event.
socket.on("room:removed", () => {
  clearSession();
  returnToEntry("你已被房主移出房间");
});
socket.on("room:closed", () => {
  clearSession();
  returnToEntry("房主已关闭房间");
});

// ── Host controls ──────────────────────────────────────────────────────────
$("open-config").addEventListener("click", () => {
  if (!currentRoomState || !isHost || !currentRoomState.game.canStart) return;
  loadDefaultConfig(currentRoomState);
  showRoomScreen("config");
});
$("back-management").addEventListener("click", () => showRoomScreen("management"));
$("deal-roles").addEventListener("click", () => {
  if (!currentRoomState || !configValidation().ok) return;
  const roleDeck = currentRoomState.roleCatalog.flatMap(role =>
    Array.from({ length: configCounts[role.id] || 0 }, () => role.id)
  );
  if (!confirm("确定发送身份？发送后不能再调整玩家和本局配置。")) return;
  emitCommandWithAck("host:start-game", { roleDeck });
});
$("start-night").addEventListener("click", () => {
  if (!confirm("确定开始夜晚？所有玩家请闭眼。")) return;
  emitCommandWithAck("host:start-night", {});
});
$("close-voting").addEventListener("click", () => {
  if (!confirm("确定关闭投票？")) return;
  emitCommandWithAck("host:close-voting", {});
});
$("begin-night-start").addEventListener("click", () => emitCommandWithAck("host:begin-night-start", {}));
$("restart-game").addEventListener("click", () => {
  if (!confirm("确定重新开始游戏？所有进度将重置，重新随机发牌。")) return;
  emitCommandWithAck("host:restart-game", {});
});
$("peek-role").addEventListener("click", () => {
  if (!currentGameState?.roleName) return;
  alert(`你的身份：${currentGameState.roleName}\n\n${currentGameState.roleDescription}`);
});

// ── Player actions ─────────────────────────────────────────────────────────
$("confirm-role").addEventListener("click", () => {
  emitCommandWithAck("player:confirm-role", { actionId: currentGameState?.actionId });
});
$("use-antidote").addEventListener("click", () => {
  if (!confirm("确定使用解药？本晚将不能再使用毒药。")) return;
  emitCommandWithAck("player:submit-witch-action", {
    actionId: currentGameState?.actionId,
    useAntidote: true,
    poisonTargetId: null,
  });
});
$("show-poison").addEventListener("click", () => {
  $("use-antidote").classList.add("hidden");
  $("show-poison").classList.add("hidden");
  $("use-no-potion").classList.add("hidden");
  $("poison-picker").classList.remove("hidden");
});
$("cancel-poison").addEventListener("click", () => renderGameState(currentGameState));
$("use-no-potion").addEventListener("click", () => {
  if (!confirm("确定本晚不使用任何药物？")) return;
  emitCommandWithAck("player:submit-witch-action", {
    actionId: currentGameState?.actionId,
    useAntidote: false,
    poisonTargetId: null,
  });
});
$("confirm-seer-result").addEventListener("click", () => {
  emitCommandWithAck("player:confirm-seer-result", { actionId: currentGameState?.actionId });
});
$("wolf-no-kill").addEventListener("click", () => {
  if (!confirm("确定今晚不击杀任何玩家？")) return;
  emitCommandWithAck("player:submit-wolf-target", {
    actionId: currentGameState?.actionId,
    targetPlayerId: null,
  });
});
$("guard-no-protection").addEventListener("click", () => {
  if (!confirm("确定今晚不守护任何玩家？")) return;
  emitCommandWithAck("player:submit-guard-target", {
    actionId: currentGameState?.actionId,
    targetPlayerId: null,
  });
});
$("hunter-no-shot").addEventListener("click", () => {
  if (!confirm("确定放弃开枪？")) return;
  emitCommandWithAck("player:submit-hunter-execution", {
    actionId: currentGameState?.actionId,
    targetPlayerId: null,
  });
});
function openExitRoomDialog() {
  if (isHost) {
    const gameInProgress = currentRoomState?.game.phase !== "lobby";
    const candidates = gameInProgress
      ? []
      : currentRoomState?.players.filter(player =>
          player.id !== currentPlayerId && player.connected
        ) || [];
    $("exit-successor").replaceChildren(
      ...candidates.map(player => new Option(`${player.seat}号 ${player.name}`, player.id))
    );
    $("transfer-exit-option").classList.toggle("hidden", candidates.length === 0);
    $("exit-room-description").textContent = gameInProgress
      ? "游戏正在进行。如需中断本局并重新建房，请关闭当前房间。"
      : candidates.length > 0
      ? "请选择将房主交给其他玩家，或者关闭整个房间。"
      : "当前没有其他在线玩家，只能关闭房间。";
    $("exit-dialog-error").textContent = "";
    $("exit-room-dialog").classList.remove("hidden");
    return;
  }
  if (!confirm("确定退出当前房间？")) return;
  emitWithAck("player:leave-room", {}, () => {
    clearSession();
    returnToEntry("你已退出房间");
  });
}
$("leave-room").addEventListener("click", openExitRoomDialog);
$("game-exit-room").addEventListener("click", openExitRoomDialog);
$("cancel-exit-room").addEventListener("click", () => {
  $("exit-room-dialog").classList.add("hidden");
});
$("confirm-transfer-exit").addEventListener("click", () => {
  const targetPlayerId = $("exit-successor").value;
  if (!targetPlayerId) {
    $("exit-dialog-error").textContent = "请选择一名在线玩家作为新房主";
    return;
  }
  emitWithAck("host:leave-and-transfer", { targetPlayerId }, () => {
    clearSession();
    returnToEntry("你已转让房主并退出房间");
  }, message => {
    $("exit-dialog-error").textContent = message;
  });
});
$("confirm-close-room").addEventListener("click", () => {
  if (!confirm("确定关闭房间？所有玩家都会退出，当前游戏进度将结束。")) return;
  emitWithAck("host:close-room", {}, () => {
    clearSession();
    returnToEntry("房间已关闭");
  }, message => {
    $("exit-dialog-error").textContent = message;
  });
});

function openPlayerNameDialog() {
  $("player-name-editor").value = currentRoomId ? currentPlayerName : savedPlayerName;
  $("player-name-dialog-error").textContent = "";
  $("player-name-dialog").classList.remove("hidden");
  $("player-name-editor").focus();
}

$("entry-player-profile").addEventListener("click", openPlayerNameDialog);
$("room-player-profile").addEventListener("click", openPlayerNameDialog);
$("cancel-player-name").addEventListener("click", () => {
  $("player-name-dialog").classList.add("hidden");
});
$("save-player-name").addEventListener("click", () => {
  const name = $("player-name-editor").value.trim();
  if (!name) {
    $("player-name-dialog-error").textContent = "请输入玩家名字";
    return;
  }
  if (!currentRoomId) {
    savePlayerName(name);
    $("player-name-dialog").classList.add("hidden");
    return;
  }
  emitWithAck("player:update-name", { name }, result => {
    savePlayerName(result.name);
    $("player-name-dialog").classList.add("hidden");
  }, message => {
    $("player-name-dialog-error").textContent = message;
  });
});
$("player-name-editor").addEventListener("keydown", event => {
  if (event.key === "Enter") $("save-player-name").click();
  if (event.key === "Escape") $("cancel-player-name").click();
});

// ── Dev / test prompt ──────────────────────────────────────────────────────
$("send-prompt").addEventListener("click", () => {
  emitWithAck("host:send-test-prompt", { targetPlayerId: $("target-player").value });
});
$("vibration-test").addEventListener("click", () => {
  setError(vibrate() ? "" : "当前浏览器不支持震动，请使用 Android Chrome 测试");
});

// Dev tools collapsible
const devToggle = $("dev-toggle");
const devContent = $("dev-content");
devToggle.addEventListener("click", () => {
  const collapsed = devContent.classList.toggle("hidden");
  devToggle.classList.toggle("collapsed", collapsed);
});

socket.on("player:test-prompt", ({ promptId }) => {
  activePromptId = promptId;
  $("prompt-received").classList.remove("hidden");
  $("prompt-choice").classList.add("hidden");
  $("prompt-overlay").classList.remove("hidden");
  vibrate();
});
$("ack-prompt").addEventListener("click", () => {
  emitWithAck("player:ack-test-prompt", { promptId: activePromptId }, () => {
    $("prompt-received").classList.add("hidden");
    $("prompt-choice").classList.remove("hidden");
  });
});
document.querySelectorAll("[data-choice]").forEach(button => {
  button.addEventListener("click", () => {
    emitWithAck("player:submit-test-choice", {
      promptId: activePromptId,
      choice: button.dataset.choice,
    }, () => {
      $("prompt-overlay").classList.add("hidden");
      activePromptId = "";
    });
  });
});

savedPlayerName = readSavedPlayerName();
currentPlayerName = savedPlayerName;
renderPlayerProfiles();

const initialSession = readSession();
if (initialSession && !sessionReplaced) {
  resumeSession(initialSession);
} else {
  socket.connect();
}
