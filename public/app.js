const SESSION_KEY = "werewolfSession";
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
  membershipActive = true;
  sessionReplaced = false;
  $("entry").classList.add("hidden");
  $("room").classList.remove("hidden");
  $("room-id").textContent = currentRoomId;
  setConnectionStatus("已连接");
}

function returnToEntry(message) {
  currentRoomId = "";
  currentPlayerId = "";
  isHost = false;
  activePromptId = "";
  currentGameState = null;
  membershipActive = false;
  document.body.classList.remove("phase-night", "phase-day");
  $("room").classList.add("hidden");
  $("prompt-overlay").classList.add("hidden");
  $("entry").classList.remove("hidden");
  $("entry-error").textContent = message || "";
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
}

function emitWithAck(event, data, onSuccess) {
  socket.timeout(5000).emit(event, data, (error, result) => {
    if (error) return setError("服务器响应超时，请重试");
    if (!result?.ok) return setError(result?.message || "操作失败，请重试");
    setError("");
    onSuccess?.(result);
  });
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

  if (state.roleName) {
    $("role-name").textContent = state.roleName;
    $("role-description").textContent = state.roleDescription;
    $("waiting-role").textContent = `你的身份：${state.roleName}`;
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
      emitWithAck("player:submit-wolf-target", {
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
      emitWithAck("player:submit-witch-action", {
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
      emitWithAck("player:submit-seer-target", {
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
      emitWithAck("player:submit-guard-target", {
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
      emitWithAck("player:submit-hunter-execution", {
        actionId: state.actionId,
        targetPlayerId: target.id,
      });
    }, "danger");
    return;
  }

  if (state.mode === "night_start") {
    showGameView("night-start-view");
    $("night-start-role").textContent = `你的身份：${state.roleName}`;
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
        emitWithAck("player:submit-vote", { actionId: state.actionId, targetId: target.id });
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
        emitWithAck("player:submit-vote", { actionId: state.actionId, targetId: target.id });
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
  socket.emit("host:create-room", { name: $("host-name").value }, result => {
    if (!result?.ok) return $("entry-error").textContent = result?.message || "创建失败";
    saveSession(result);
    enterRoom(result);
  });
});

$("join-room").addEventListener("click", () => {
  socket.emit("player:join-room", { roomId: $("room-input").value, name: $("player-name").value }, result => {
    if (!result?.ok) return $("entry-error").textContent = result?.message || "加入失败";
    saveSession(result);
    enterRoom(result);
  });
});

// ── Socket connection ──────────────────────────────────────────────────────
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
});

// ── Room state ─────────────────────────────────────────────────────────────
socket.on("room:state", state => {
  if (state.roomId !== currentRoomId) return;
  membershipActive = true;
  setConnectionStatus("已连接");
  setError("");
  isHost = state.viewer.playerId === currentPlayerId && state.viewer.isHost;
  $("host-controls").classList.toggle("hidden", !isHost);

  $("players").replaceChildren(...state.players.map(player => {
    const row = document.createElement("div");
    row.className = "player";

    const seat = document.createElement("span");
    seat.className = "seat";
    seat.textContent = player.seat;

    const name = document.createElement("span");
    name.className = "player-name-label";
    name.textContent = `${player.name}${player.isHost ? "（房主）" : ""}${player.connected ? "" : "（离线）"}`;

    row.append(seat, name);

    if (isHost && player.id !== currentPlayerId) {
      const actions = document.createElement("span");
      actions.className = "player-actions";

      const transfer = document.createElement("button");
      transfer.className = "secondary";
      transfer.textContent = "设为房主";
      transfer.disabled = !player.connected;
      transfer.addEventListener("click", () => {
        if (!confirm(`确定将房主转让给 ${player.seat}号 ${player.name}？`)) return;
        emitWithAck("host:transfer-host", { targetPlayerId: player.id });
      });

      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "移除";
      remove.disabled = state.game.phase !== "lobby";
      remove.addEventListener("click", () => {
        if (!confirm(`确定将 ${player.seat}号 ${player.name} 移出房间？`)) return;
        emitWithAck("host:remove-player", { targetPlayerId: player.id });
      });

      actions.append(transfer, remove);
      row.append(actions);
    }
    return row;
  }));

  $("leave-room").disabled = state.game.phase !== "lobby";

  if (!isHost) return;

  const game = state.game;
  $("start-game").disabled = !game.canStart;
  $("start-game").textContent = game.phase === "lobby"
    ? game.canStart ? "开始游戏并随机发牌" : `等待玩家（${state.players.length}/${game.maxPlayers}，至少${game.minPlayers}人）`
    : "游戏已开始";
  // dev-content visibility managed separately by toggle; just show/hide the whole dev section
  // when not in lobby phase, hide it to avoid confusion mid-game
  if (game.phase !== "lobby") $("dev-content").classList.add("hidden");

  const inVote = game.phase === "day_vote" || game.phase === "day_pk";
  $("start-night").classList.toggle("hidden", game.phase !== "night_start");
  $("close-voting").classList.toggle("hidden", !inVote);
  $("vote-tally").classList.toggle("hidden", !inVote && game.phase !== "day_result");
  $("begin-night-start").classList.toggle("hidden", game.phase !== "day_result");
  $("restart-game").classList.toggle("hidden", game.phase === "lobby");

  if (inVote || game.phase === "day_result") {
    const tallyText = game.voteTally
      ? Object.entries(game.voteTally)
          .map(([id, count]) => {
            const player = state.players.find(p => p.id === id);
            return `${player?.seat || "?"}号 ${player?.name || ""}：${count}票`;
          })
          .join("　")
      : `已投票：${game.votesCast || 0}/${game.votesRequired || 0}人`;
    $("vote-tally").textContent = tallyText;
  }

  const d = game.dayNumber;
  const n = game.nightNumber;
  const total = state.players.length;
  const progressLabels = {
    lobby: "大厅等待中",
    role_reveal: `等待玩家确认身份（${game.confirmedRoles}/${total}）`,
    night_start: `第${n}夜：等待开始`,
    night_werewolf: `第${n}夜：狼人行动中`,
    night_guard: `第${n}夜：守卫行动中`,
    night_witch: `第${n}夜：女巫行动中`,
    night_seer: `第${n}夜：预言家行动中`,
    night_complete: `第${n}夜结束，进入白天`,
    day_vote: `第${d}天：投票中（${game.votesCast || 0}/${game.votesRequired || 0}人已投）`,
    day_pk: `第${d}天：平票，重新投票`,
    day_result: `第${d}天：结果已出`,
    day_hunter: "天亮/白天：猎人技能触发",
    game_over: `游戏结束 — ${game.winner === "wolf" ? "狼人胜利" : "好人胜利"}`,
  };
  $("game-progress").textContent = progressLabels[game.phase] || "游戏进行中";

  const select = $("target-player");
  const selected = select.value;
  const candidates = state.players.filter(p => !p.isHost && p.connected);
  select.replaceChildren(...candidates.map(p => new Option(`${p.seat}号 ${p.name}`, p.id)));
  if (candidates.some(p => p.id === selected)) select.value = selected;
  $("send-prompt").disabled = candidates.length === 0;

  const prompt = state.testPrompt;
  if (prompt) {
    const target = state.players.find(p => p.id === prompt.targetPlayerId);
    const labels = {
      sent: "已发送，等待玩家确认",
      acknowledged: "玩家已确认，等待提交",
      submitted: `玩家已提交：${prompt.choice}`,
    };
    $("prompt-status").textContent = `${target?.seat || "?"}号 ${target?.name || "玩家"}：${labels[prompt.status]}`;
  }
});

// ── Audio ──────────────────────────────────────────────────────────────────
function playNightEndAudio() {
  try {
    const ctx = new AudioContext();
    const notes = [880, 1108, 1318, 880];
    let t = ctx.currentTime;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
      t += 0.35;
    }
  } catch {}
}

// ── Game events ────────────────────────────────────────────────────────────
socket.on("player:game-state", renderGameState);
socket.on("player:action-alert", () => vibrate([300, 150, 300]));
socket.on("game:night-complete", () => {
  vibrate([160, 100, 160, 100, 500]);
  if (isHost) playNightEndAudio();
});
socket.on("game:over", () => vibrate([500, 200, 500, 200, 500]));
socket.on("room:removed", () => {
  clearSession();
  returnToEntry("你已被房主移出房间");
});

// ── Host controls ──────────────────────────────────────────────────────────
$("start-game").addEventListener("click", () => {
  if (!confirm("确定开始游戏并随机分配身份？开始后不能再加入玩家。")) return;
  emitWithAck("host:start-game", {});
});
$("start-night").addEventListener("click", () => {
  if (!confirm("确定开始夜晚？所有玩家请闭眼。")) return;
  emitWithAck("host:start-night", {});
});
$("close-voting").addEventListener("click", () => {
  if (!confirm("确定关闭投票？")) return;
  emitWithAck("host:close-voting", {});
});
$("begin-night-start").addEventListener("click", () => emitWithAck("host:begin-night-start", {}));
$("restart-game").addEventListener("click", () => {
  if (!confirm("确定重新开始游戏？所有进度将重置，重新随机发牌。")) return;
  emitWithAck("host:restart-game", {});
});

// ── Player actions ─────────────────────────────────────────────────────────
$("confirm-role").addEventListener("click", () => {
  emitWithAck("player:confirm-role", { actionId: currentGameState?.actionId });
});
$("use-antidote").addEventListener("click", () => {
  if (!confirm("确定使用解药？本晚将不能再使用毒药。")) return;
  emitWithAck("player:submit-witch-action", {
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
  emitWithAck("player:submit-witch-action", {
    actionId: currentGameState?.actionId,
    useAntidote: false,
    poisonTargetId: null,
  });
});
$("confirm-seer-result").addEventListener("click", () => {
  emitWithAck("player:confirm-seer-result", { actionId: currentGameState?.actionId });
});
$("wolf-no-kill").addEventListener("click", () => {
  if (!confirm("确定今晚不击杀任何玩家？")) return;
  emitWithAck("player:submit-wolf-target", {
    actionId: currentGameState?.actionId,
    targetPlayerId: null,
  });
});
$("guard-no-protection").addEventListener("click", () => {
  if (!confirm("确定今晚不守护任何玩家？")) return;
  emitWithAck("player:submit-guard-target", {
    actionId: currentGameState?.actionId,
    targetPlayerId: null,
  });
});
$("hunter-no-shot").addEventListener("click", () => {
  if (!confirm("确定放弃开枪？")) return;
  emitWithAck("player:submit-hunter-execution", {
    actionId: currentGameState?.actionId,
    targetPlayerId: null,
  });
});
$("leave-room").addEventListener("click", () => {
  if (!confirm("确定退出当前房间？")) return;
  emitWithAck("player:leave-room", {}, () => {
    clearSession();
    returnToEntry("你已退出房间");
  });
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
