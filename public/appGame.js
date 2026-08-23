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
