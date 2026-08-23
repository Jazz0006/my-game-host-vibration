// ── Game events ────────────────────────────────────────────────────────────
// Authoritative private PlayerView and migrated lifecycle events now arrive
// through ClientSession/client:state and ClientSession/client:event.

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
