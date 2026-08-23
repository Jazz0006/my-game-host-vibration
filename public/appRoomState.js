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
