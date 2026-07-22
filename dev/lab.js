const state = {
  roomId: "",
  players: [],
  adding: false,
  confirmingAll: false,
  nextPlayerNumber: 2,
};

const elements = {
  roomInput: document.querySelector("#room-input"),
  playerName: document.querySelector("#player-name"),
  addPlayer: document.querySelector("#add-player"),
  roomId: document.querySelector("#room-id"),
  clientCount: document.querySelector("#client-count"),
  onlineCount: document.querySelector("#online-count"),
  notice: document.querySelector("#notice"),
  players: document.querySelector("#players"),
  runState: document.querySelector("#run-state"),
  eventLog: document.querySelector("#event-log"),
  clearLog: document.querySelector("#clear-log"),
  confirmAllRoles: document.querySelector("#confirm-all-roles"),
};

function log(message, level = "") {
  const item = document.createElement("li");
  const time = document.createElement("time");
  const content = document.createElement("span");
  time.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  content.textContent = message;
  if (level) content.className = level;
  item.append(time, content);
  elements.eventLog.append(item);
  elements.eventLog.scrollTop = elements.eventLog.scrollHeight;
}

function showNotice(message, kind = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice${kind ? ` ${kind}` : ""}`;
}

function createSocket() {
  return io({
    forceNew: true,
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
  });
}

const labMonitor = createSocket();

function removeVirtualPlayer(player, message) {
  if (player.removed) return;
  player.removed = true;
  const index = state.players.indexOf(player);
  if (index >= 0) state.players.splice(index, 1);
  player.socket.disconnect();
  showNotice(message, "success");
  log(`${player.name} 被房主移出，已从实验室移除`, "warn");
  render();
}

labMonitor.on("dev:player-removed", ({ roomId, playerId }) => {
  if (roomId !== state.roomId) return;
  const player = state.players.find(item => item.playerId === playerId);
  if (player) removeVirtualPlayer(player, `${player.name} 已被房主移出房间。`);
});

function waitForConnection(socket, label) {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 连接服务器超时`)), 5000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", error => {
      clearTimeout(timer);
      reject(new Error(`${label} 连接失败：${error.message}`));
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, result) => {
      if (error) return reject(new Error(`${event} 响应超时`));
      if (!result?.ok) return reject(new Error(result?.message || `${event} 失败`));
      resolve(result);
    });
  });
}

function createButton(label, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function createTargetSelect(targets, label) {
  const select = document.createElement("select");
  select.className = "player-target";
  select.setAttribute("aria-label", label);
  select.replaceChildren(...targets.map(target =>
    new Option(`${target.seat}号 ${target.name}`, target.id)
  ));
  return select;
}

async function performAction(player, event, payload, successMessage) {
  if (player.actionPending || !player.connected) return;
  player.actionPending = true;
  render();
  try {
    await emitAck(player.socket, event, payload);
    showNotice(`${player.name}：${successMessage}`, "success");
    log(`${player.name}：${successMessage}`, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNotice(`${player.name}：${message}`, "error");
    log(`${player.name}：${message}`, "error");
  } finally {
    player.actionPending = false;
    render();
  }
}

function renderGameControls(player) {
  const body = document.createElement("div");
  body.className = "player-body";
  const status = document.createElement("div");
  status.className = "player-status";
  const actions = document.createElement("div");
  actions.className = "player-actions";
  const game = player.gameState;

  if (!player.connected) {
    status.textContent = "连接已断开，无法操作";
  } else if (!game || game.mode === "lobby") {
    status.textContent = "等待房主开始游戏";
  } else {
    const role = document.createElement("div");
    role.className = "player-role";
    role.textContent = `身份：${game.roleName}`;
    body.append(role);

    if (game.mode === "role_reveal") {
      status.textContent = game.roleDescription;
      actions.append(createButton(
        player.actionPending ? "正在确认……" : "确认身份",
        () => void performAction(
          player,
          "player:confirm-role",
          { actionId: game.actionId },
          "已确认身份",
        ),
        "primary wide",
      ));
    } else if (game.mode === "waiting") {
      status.textContent = "等待其他玩家完成当前行动";
    } else if (game.mode === "wolf_action") {
      status.textContent = "狼人行动：选择今晚的击杀目标";
      const select = createTargetSelect(game.targets, `${player.name}的狼人击杀目标`);
      body.append(select);
      actions.append(
        createButton("确认击杀", () => void performAction(
          player,
          "player:submit-wolf-target",
          { actionId: game.actionId, targetPlayerId: select.value },
          `已选择击杀 ${select.selectedOptions[0]?.textContent || "目标"}`,
        ), "danger wide"),
        createButton("本晚不击杀", () => void performAction(
          player,
          "player:submit-wolf-target",
          { actionId: game.actionId, targetPlayerId: null },
          "本晚选择空刀",
        )),
      );
    } else if (game.mode === "witch_action") {
      const attacked = game.attackedPlayer;
      status.textContent = attacked
        ? `女巫行动：${attacked.seat}号 ${attacked.name} 被狼人袭击`
        : "女巫行动：今晚无人被袭击";
      const poisonSelect = createTargetSelect(game.poisonTargets, `${player.name}的毒药目标`);
      actions.append(createButton("跳过（本晚不用药）", () => void performAction(
        player,
        "player:submit-witch-action",
        { actionId: game.actionId, useAntidote: false, poisonTargetId: null },
        "本晚不使用药物",
      )));
      if (game.antidoteAvailable) {
        actions.append(createButton("使用解药", () => void performAction(
          player,
          "player:submit-witch-action",
          { actionId: game.actionId, useAntidote: true, poisonTargetId: null },
          "已使用解药",
        ), "primary"));
      }
      if (game.poisonAvailable) {
        body.append(poisonSelect);
        actions.append(createButton("毒杀所选玩家", () => void performAction(
          player,
          "player:submit-witch-action",
          { actionId: game.actionId, useAntidote: false, poisonTargetId: poisonSelect.value },
          `已毒杀 ${poisonSelect.selectedOptions[0]?.textContent || "目标"}`,
        ), "danger wide"));
      }
    } else if (game.mode === "seer_action") {
      status.textContent = "预言家行动：选择一名玩家查验阵营";
      const select = createTargetSelect(game.targets, `${player.name}的查验目标`);
      body.append(select);
      actions.append(createButton("确认查验", () => void performAction(
        player,
        "player:submit-seer-target",
        { actionId: game.actionId, targetPlayerId: select.value },
        `已查验 ${select.selectedOptions[0]?.textContent || "目标"}`,
      ), "primary wide"));
    } else if (game.mode === "seer_result") {
      status.textContent = `查验目标：${game.checkedPlayer.seat}号 ${game.checkedPlayer.name}`;
      const result = document.createElement("div");
      result.className = `alignment ${game.checkedAlignment}`;
      result.textContent = game.checkedAlignment === "werewolf" ? "查验结果：狼人" : "查验结果：好人";
      body.append(result);
      actions.append(createButton("确认查验结果", () => void performAction(
        player,
        "player:confirm-seer-result",
        { actionId: game.actionId },
        "已确认查验结果",
      ), "primary wide"));
    } else if (game.mode === "guard_action") {
      status.textContent = "守卫行动：选择今晚保护的玩家";
      const select = createTargetSelect(game.targets, `${player.name}的保护目标`);
      body.append(select);
      actions.append(
        createButton("跳过（本晚不守护）", () => void performAction(
          player,
          "player:submit-guard-target",
          { actionId: game.actionId, targetPlayerId: null },
          "本晚选择空守",
        )),
        createButton("确认保护", () => void performAction(
          player,
          "player:submit-guard-target",
          { actionId: game.actionId, targetPlayerId: select.value },
          `已保护 ${select.selectedOptions[0]?.textContent || "目标"}`,
        ), "primary wide"),
      );
    } else if (game.mode === "hunter_execution") {
      status.textContent = "猎人技能：选择带走的玩家";
      const select = createTargetSelect(game.targets, `${player.name}的猎人目标`);
      body.append(select);
      actions.append(
        createButton("确认射击", () => void performAction(
          player,
          "player:submit-hunter-execution",
          { actionId: game.actionId, targetPlayerId: select.value },
          `已射击 ${select.selectedOptions[0]?.textContent || "目标"}`,
        ), "danger wide"),
        createButton("不开枪", () => void performAction(
          player,
          "player:submit-hunter-execution",
          { actionId: game.actionId, targetPlayerId: null },
          "已放弃开枪",
        )),
      );
    } else if (game.mode === "night_complete") {
      status.textContent = game.deaths.length
        ? `天亮：${game.deaths.map(target => `${target.seat}号 ${target.name}`).join("、")} 死亡`
        : "天亮：昨夜是平安夜";
    } else if (game.mode === "day_announce") {
      status.textContent = game.deaths.length
        ? `白天公告：${game.deaths.map(target => `${target.seat}号 ${target.name}`).join("、")} 昨夜死亡`
        : "白天公告：昨夜平安夜";
    } else if (game.mode === "day_vote" || game.mode === "day_pk") {
      if (game.myVote) {
        status.textContent = `已投票，等待房主关闭投票`;
      } else {
        status.textContent = game.mode === "day_pk"
          ? "PK投票：从平票玩家中选择放逐目标"
          : "投票：选择要放逐的玩家";
        const select = createTargetSelect(game.targets, `${player.name}的投票目标`);
        body.append(select);
        actions.append(createButton("投票放逐", () => void performAction(
          player,
          "player:submit-vote",
          { actionId: game.actionId, targetId: select.value },
          `已投票放逐 ${select.selectedOptions[0]?.textContent || "目标"}`,
        ), "danger wide"));
      }
    } else if (game.mode === "spectator") {
      status.textContent = "已出局，旁观中";
    } else if (game.mode === "game_over") {
      status.textContent = game.winner === "wolf" ? "游戏结束：狼人胜利" : "游戏结束：好人胜利";
    } else {
      status.textContent = "等待游戏状态更新";
    }
  }

  for (const button of actions.querySelectorAll("button")) {
    button.disabled = player.actionPending || !player.connected;
  }
  body.append(status, actions);
  return body;
}

function render() {
  elements.roomId.textContent = state.roomId || "未选择";
  elements.clientCount.textContent = String(state.players.length);
  elements.onlineCount.textContent = String(state.players.filter(player => player.connected).length);
  elements.runState.textContent = state.adding
    ? "正在添加"
    : state.players.length > 0
      ? `已添加 ${state.players.length} 名`
      : "等待添加";
  elements.addPlayer.disabled = state.adding;
  elements.roomInput.disabled = Boolean(state.roomId);
  elements.playerName.disabled = state.adding;
  const confirmablePlayers = state.players.filter(player =>
    player.connected && player.gameState?.mode === "role_reveal" && !player.actionPending
  );
  elements.confirmAllRoles.disabled = state.confirmingAll || confirmablePlayers.length === 0;
  elements.confirmAllRoles.textContent = state.confirmingAll
    ? "正在确认……"
    : `全部确认身份${confirmablePlayers.length ? `（${confirmablePlayers.length}）` : ""}`;

  if (state.players.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "尚无虚拟玩家";
    elements.players.replaceChildren(empty);
    return;
  }

  const cards = state.players.map(player => {
    const card = document.createElement("article");
    card.className = `player-card${player.connected ? "" : " offline"}`;

    const head = document.createElement("div");
    head.className = "player-head";
    const seat = document.createElement("span");
    seat.className = "seat";
    seat.textContent = String(player.seat);
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    const connection = document.createElement("span");
    connection.className = "connection";
    connection.textContent = player.connected ? "在线" : "连接已断开";
    const vitality = document.createElement("span");
    const isDead = player.gameState?.deadPlayerIds?.includes(player.playerId);
    vitality.className = `vitality ${isDead ? "dead" : "alive"}`;
    vitality.textContent = isDead ? "已出局" : "存活";
    head.append(seat, name, vitality, connection);

    const detail = document.createElement("div");
    detail.className = "player-detail";
    detail.textContent = `玩家 ID：${player.playerId.slice(0, 8)}`;
    card.append(head, detail, renderGameControls(player));
    return card;
  });

  elements.players.replaceChildren(...cards);
}

async function addVirtualPlayer() {
  const requestedRoomId = elements.roomInput.value.trim();
  const name = elements.playerName.value.trim();
  if (!/^\d{6}$/u.test(requestedRoomId)) {
    showNotice("请输入正确的 6 位房间号。", "error");
    return;
  }
  if (state.roomId && requestedRoomId !== state.roomId) {
    showNotice(`当前实验室已经连接房间 ${state.roomId}，请刷新页面后再连接其他房间。`, "error");
    return;
  }
  if (!name) {
    showNotice("请输入虚拟玩家名称。", "error");
    return;
  }

  state.adding = true;
  render();
  showNotice(`正在将 ${name} 加入房间 ${requestedRoomId}……`);
  const socket = createSocket();

  try {
    await waitForConnection(socket, name);
    const joined = await emitAck(socket, "player:join-room", {
      roomId: requestedRoomId,
      name,
    });
    const player = {
      socket,
      playerId: joined.playerId,
      seat: joined.seat,
      name,
      connected: true,
      removed: false,
      gameState: null,
      actionPending: false,
    };
    socket.on("player:game-state", gameState => {
      player.gameState = gameState;
      render();
    });
    socket.on("player:action-alert", ({ phase }) => {
      log(`${player.name} 收到行动提醒：${phase}`, "warn");
    });
    socket.on("game:night-complete", () => {
      log(`${player.name} 收到夜间结束提醒`, "ok");
    });
    socket.on("room:removed", () => {
      removeVirtualPlayer(player, `${player.name} 已被房主移出房间。`);
    });
    socket.on("disconnect", () => {
      if (player.removed) return;
      player.connected = false;
      log(`${player.name} 的连接已断开`, "warn");
      render();
    });

    state.roomId = requestedRoomId;
    state.players.push(player);
    state.nextPlayerNumber += 1;
    elements.playerName.value = `虚拟玩家 ${state.nextPlayerNumber} 号`;
    showNotice(`${name} 已加入房间 ${requestedRoomId}，座位号为 ${joined.seat}。`, "success");
    log(`${name} 加入房间，座位 ${joined.seat}`, "ok");
  } catch (error) {
    socket.disconnect();
    const message = error instanceof Error ? error.message : String(error);
    showNotice(message, "error");
    log(message, "error");
  } finally {
    state.adding = false;
    render();
  }
}

async function confirmAllRoles() {
  const players = state.players.filter(player =>
    player.connected && player.gameState?.mode === "role_reveal" && !player.actionPending
  );
  if (players.length === 0 || state.confirmingAll) return;
  state.confirmingAll = true;
  for (const player of players) player.actionPending = true;
  render();
  const results = await Promise.allSettled(players.map(player =>
    emitAck(player.socket, "player:confirm-role", { actionId: player.gameState.actionId })
  ));
  let succeeded = 0;
  results.forEach((result, index) => {
    const player = players[index];
    if (!player) return;
    player.actionPending = false;
    if (result.status === "fulfilled") {
      succeeded += 1;
      log(`${player.name}：已确认身份`, "ok");
    } else {
      log(`${player.name}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`, "error");
    }
  });
  state.confirmingAll = false;
  showNotice(`已确认 ${succeeded}/${players.length} 名虚拟玩家身份。`, succeeded === players.length ? "success" : "error");
  render();
}

elements.addPlayer.addEventListener("click", addVirtualPlayer);
elements.playerName.addEventListener("keydown", event => {
  if (event.key === "Enter") void addVirtualPlayer();
});
elements.clearLog.addEventListener("click", () => elements.eventLog.replaceChildren());
elements.confirmAllRoles.addEventListener("click", () => void confirmAllRoles());

window.addEventListener("beforeunload", () => {
  labMonitor.disconnect();
  for (const player of state.players) player.socket.disconnect();
});

render();
