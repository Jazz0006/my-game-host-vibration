// C4 recovery diagnostics plus C4.4 interaction timeout UI. This script keeps
// secret actor identity private: players receive only their own timeout state,
// while the host configures a room-wide duration before the game starts.
const hostRecoveryStatusNode = document.getElementById("host-recovery-status");

socket.on("room:state", state => {
  if (hostRecoveryStatusNode) {
    const recovery = state?.viewer?.isHost ? state?.game?.recovery : undefined;
    hostRecoveryStatusNode.classList.toggle("hidden", !recovery);
    if (recovery) {
      if (recovery.waitingCount === 0) {
        hostRecoveryStatusNode.textContent = "恢复状态：当前无需玩家操作";
      } else {
        const pendingLabel = recovery.hasPendingInteraction ? "等待行动" : "等待操作";
        hostRecoveryStatusNode.textContent =
          `恢复状态：${pendingLabel} ${recovery.waitingCount} 人 · ` +
          `在线 ${recovery.onlineWaitingCount} · 离线 ${recovery.offlineWaitingCount}`;
      }
    }
  }

  renderInteractionTimeoutConfig(state);
});

// ── C4.4 Host timeout configuration ────────────────────────────────────────
let timeoutConfigRoomId = "";
let timeoutConfigLoaded = false;

function ensureTimeoutConfigControl() {
  let container = document.getElementById("interaction-timeout-config");
  if (container) return container;

  const configActions = document.querySelector("#config-screen .config-actions");
  if (!configActions) return null;

  container = document.createElement("div");
  container.id = "interaction-timeout-config";
  container.className = "status";

  const label = document.createElement("label");
  label.htmlFor = "interaction-timeout-seconds";
  label.textContent = "夜间行动超时：";

  const select = document.createElement("select");
  select.id = "interaction-timeout-seconds";
  for (const [value, text] of [
    [0, "关闭"],
    [15, "15 秒"],
    [30, "30 秒（推荐）"],
    [45, "45 秒"],
    [60, "60 秒"],
  ]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = text;
    select.append(option);
  }
  select.value = "30";
  select.addEventListener("change", () => {
    socket.timeout(5000).emit(
      "host:set-interaction-timeout",
      { timeoutSeconds: Number(select.value) },
      (error, result) => {
        if (error || !result?.ok) {
          setError(result?.message || "保存行动超时失败，请重试");
          return;
        }
        select.value = String(result.timeoutSeconds);
        setError("");
      },
    );
  });

  const help = document.createElement("p");
  help.className = "muted";
  help.textContent = "仅夜间秘密行动计时；临近超时会再次震动，玩家可延长一次。";

  container.append(label, select, help);
  configActions.prepend(container);
  return container;
}

function renderInteractionTimeoutConfig(state) {
  const isHostLobby = state?.viewer?.isHost && state?.game?.phase === "lobby";
  const control = ensureTimeoutConfigControl();
  if (!control) return;
  control.classList.toggle("hidden", !isHostLobby);
  if (!isHostLobby) return;

  if (timeoutConfigRoomId !== state.roomId) {
    timeoutConfigRoomId = state.roomId;
    timeoutConfigLoaded = false;
  }
  if (timeoutConfigLoaded) return;
  timeoutConfigLoaded = true;

  socket.timeout(5000).emit("host:get-interaction-timeout", {}, (error, result) => {
    if (error || !result?.ok) {
      timeoutConfigLoaded = false;
      return;
    }
    const select = document.getElementById("interaction-timeout-seconds");
    if (select) select.value = String(result.timeoutSeconds);
  });
}

// ── C4.4 Acting-player countdown ───────────────────────────────────────────
let currentTimeoutState = null;

function ensureTimeoutPanel() {
  let panel = document.getElementById("interaction-timeout-panel");
  if (panel) return panel;

  const gamePanel = document.getElementById("game-panel");
  if (!gamePanel) return null;

  panel = document.createElement("div");
  panel.id = "interaction-timeout-panel";
  panel.className = "status hidden";

  const text = document.createElement("strong");
  text.id = "interaction-timeout-text";

  const extend = document.createElement("button");
  extend.id = "extend-interaction-timeout";
  extend.className = "secondary";
  extend.type = "button";
  extend.textContent = "延长 30 秒";
  extend.addEventListener("click", () => {
    const state = currentTimeoutState;
    if (!state?.active || !state.actionId || !state.canExtend) return;
    emitCommandWithAck(
      "player:extend-interaction-timeout",
      { actionId: state.actionId },
      result => {
        if (currentTimeoutState?.actionId !== state.actionId) return;
        currentTimeoutState = {
          ...currentTimeoutState,
          deadlineAt: result.deadlineAt,
          canExtend: result.canExtend,
          warning: false,
        };
        renderTimeoutCountdown();
      },
    );
  });

  const hint = document.createElement("span");
  hint.className = "muted";
  hint.textContent = " 超时后本次行动将自动安全跳过。";

  panel.append(text, document.createTextNode(" "), extend, hint);
  gamePanel.prepend(panel);
  return panel;
}

function renderTimeoutCountdown() {
  const panel = ensureTimeoutPanel();
  const text = document.getElementById("interaction-timeout-text");
  const extend = document.getElementById("extend-interaction-timeout");
  if (!panel || !text || !extend) return;

  const state = currentTimeoutState;
  if (!state?.active || !state.deadlineAt) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  const remainingMs = Math.max(0, state.deadlineAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  text.textContent = state.warning
    ? `即将超时：${remainingSeconds} 秒`
    : `行动剩余：${remainingSeconds} 秒`;
  extend.classList.toggle("hidden", !state.canExtend);
  extend.disabled = !state.canExtend;
}

socket.on("player:interaction-timeout-state", state => {
  if (!state?.active) {
    if (!currentTimeoutState || !state?.actionId || currentTimeoutState.actionId === state.actionId) {
      currentTimeoutState = null;
    }
  } else {
    currentTimeoutState = state;
  }
  renderTimeoutCountdown();
});

socket.on("player:interaction-timeout-error", payload => {
  if (payload?.message) setError(payload.message);
});

setInterval(renderTimeoutCountdown, 250);
