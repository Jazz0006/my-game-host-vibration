const state = {
  roomId: "",
  players: [],
  adding: false,
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
    head.append(seat, name, connection);

    const detail = document.createElement("div");
    detail.className = "player-detail";
    detail.textContent = `玩家 ID：${player.playerId.slice(0, 8)}`;
    card.append(head, detail);
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
    };
    socket.on("disconnect", () => {
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

elements.addPlayer.addEventListener("click", addVirtualPlayer);
elements.playerName.addEventListener("keydown", event => {
  if (event.key === "Enter") void addVirtualPlayer();
});
elements.clearLog.addEventListener("click", () => elements.eventLog.replaceChildren());

window.addEventListener("beforeunload", () => {
  for (const player of state.players) player.socket.disconnect();
});

render();
