const elements = {
  playerCount: document.querySelector("#player-count"),
  reset: document.querySelector("#reset-simulator"),
  roomId: document.querySelector("#room-id"),
  roomRevision: document.querySelector("#room-revision"),
  status: document.querySelector("#simulator-status"),
  viewerSelect: document.querySelector("#viewer-select"),
  phoneConnection: document.querySelector("#phone-connection"),
  phoneIdentity: document.querySelector("#phone-identity"),
  phoneRoom: document.querySelector("#phone-room"),
  phoneModerator: document.querySelector("#phone-moderator"),
  phonePlayers: document.querySelector("#phone-players"),
  phonePrivate: document.querySelector("#phone-private"),
  players: document.querySelector("#virtual-players"),
  moderatorSelect: document.querySelector("#moderator-select"),
  setModerator: document.querySelector("#set-moderator"),
  automaticModerator: document.querySelector("#automatic-moderator"),
  commandType: document.querySelector("#command-type"),
  commandPayload: document.querySelector("#command-payload"),
  sendCommand: document.querySelector("#send-command"),
  roomProjection: document.querySelector("#room-projection"),
  playerView: document.querySelector("#player-view"),
  trace: document.querySelector("#trace"),
};

let simulatorState = null;
let selectedPlayerId = "";

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = "notice" + (kind ? " " + kind : "");
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload && payload.message ? payload.message : "Simulator request failed (" + response.status + ")");
  }
  return payload;
}

function selectedClient() {
  return simulatorState && simulatorState.clients
    ? simulatorState.clients.find(client => client.playerId === selectedPlayerId) || null
    : null;
}

function shortId(value) {
  return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : value || "";
}

function pretty(value) {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function createButton(label, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function clientLabel(client) {
  const seat = client.seat === null ? "?" : client.seat;
  const roles = [
    client.isHost ? "Owner" : "",
    client.isGameModerator ? "Storyteller" : "",
  ].filter(Boolean);
  return seat + "号 " + client.name + (roles.length ? " · " + roles.join(" / ") : "");
}

function syncSelections() {
  const clients = simulatorState && simulatorState.clients ? simulatorState.clients : [];
  if (!clients.some(client => client.playerId === selectedPlayerId)) {
    selectedPlayerId = clients[0] ? clients[0].playerId : "";
  }

  const viewerOptions = clients.map(client => new Option(clientLabel(client), client.playerId));
  elements.viewerSelect.replaceChildren(...viewerOptions);
  elements.viewerSelect.value = selectedPlayerId;

  const automatic = new Option("自动说书人", "");
  const moderatorOptions = clients.map(client => new Option(clientLabel(client), client.playerId));
  elements.moderatorSelect.replaceChildren(automatic, ...moderatorOptions);
  const humanModerator = clients.find(client => client.isGameModerator);
  elements.moderatorSelect.value = humanModerator ? humanModerator.playerId : "";
}

function renderPhone(client) {
  if (!client) {
    elements.phoneConnection.textContent = "未建立模拟桌";
    elements.phoneIdentity.textContent = "选择或建立一个 Simulator room";
    elements.phoneRoom.textContent = "—";
    elements.phoneModerator.textContent = "—";
    elements.phonePlayers.replaceChildren();
    elements.phonePrivate.textContent = "暂无 authoritative PlayerView";
    return;
  }

  const room = client.roomProjection;
  elements.phoneConnection.textContent =
    client.connectionStatus + " · gen " + client.generation + " · rev " + (client.roomRevision ?? "—");
  elements.phoneConnection.className =
    "phone-connection " + (client.connectionStatus === "Connected" ? "online" : "offline");
  elements.phoneIdentity.textContent = clientLabel(client) + " · " + shortId(client.playerId);
  elements.phoneRoom.textContent = room ? room.roomId : "—";

  const assignment = room ? room.gameModerator : null;
  if (assignment && assignment.mode === "human") {
    const storyteller = room.players.find(player => player.id === assignment.playerId);
    elements.phoneModerator.textContent = storyteller
      ? storyteller.seat + "号 " + storyteller.name
      : shortId(assignment.playerId);
  } else {
    elements.phoneModerator.textContent = "自动";
  }

  const playerRows = (room ? room.players : []).map(player => {
    const row = document.createElement("div");
    row.className = "phone-player";
    const seat = document.createElement("span");
    seat.className = "phone-seat";
    seat.textContent = String(player.seat);
    const name = document.createElement("span");
    name.textContent = player.name;
    const marks = document.createElement("small");
    const marker = [
      player.id === client.playerId ? "我" : "",
      player.isHost ? "房主" : "",
      assignment && assignment.mode === "human" && assignment.playerId === player.id ? "说书人" : "",
    ].filter(Boolean);
    marks.textContent = marker.join(" · ");
    row.append(seat, name, marks);
    return row;
  });
  elements.phonePlayers.replaceChildren(...playerRows);

  const view = client.playerView;
  elements.phonePrivate.replaceChildren();
  if (!view || typeof view !== "object") {
    elements.phonePrivate.textContent = "暂无 authoritative PlayerView";
    return;
  }

  const heading = document.createElement("strong");
  const roleName = view.roleNameZh || view.roleName;
  heading.textContent = roleName ? "身份：" + roleName : "Private PlayerView";
  const summary = document.createElement("span");
  summary.textContent = [
    view.phase ? "phase: " + view.phase : "",
    view.mode ? "mode: " + view.mode : "",
  ].filter(Boolean).join(" · ");
  elements.phonePrivate.append(heading, summary);

  if (view.nightStep) {
    const wake = document.createElement("div");
    wake.className = "private-highlight";
    wake.textContent = "当前私密夜间步骤：" + (view.nightStep.roleId || view.nightStep.id || "active");
    elements.phonePrivate.append(wake);
  }
  if (view.demonInfo) {
    const info = document.createElement("div");
    info.className = "private-highlight";
    info.textContent = "当前 PlayerView 包含 Demon Info";
    elements.phonePrivate.append(info);
  }
}

function renderVirtualPlayers() {
  const clients = simulatorState && simulatorState.clients ? simulatorState.clients : [];
  if (clients.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "尚未建立模拟桌。";
    elements.players.replaceChildren(empty);
    return;
  }

  const cards = clients.map(client => {
    const card = document.createElement("article");
    card.className = "player-card" +
      (client.connectionStatus === "Connected" ? "" : " offline") +
      (client.playerId === selectedPlayerId ? " selected" : "");

    const head = document.createElement("div");
    head.className = "player-head";
    const seat = document.createElement("span");
    seat.className = "seat";
    seat.textContent = String(client.seat ?? "?");
    const title = document.createElement("div");
    title.className = "player-title";
    const name = document.createElement("strong");
    name.textContent = client.name;
    const id = document.createElement("small");
    id.textContent = shortId(client.playerId);
    title.append(name, id);
    const connection = document.createElement("span");
    connection.className = "connection";
    connection.textContent = client.connectionStatus;
    head.append(seat, title, connection);

    const badges = document.createElement("div");
    badges.className = "badges";
    if (client.isHost) {
      const badge = document.createElement("span");
      badge.textContent = "Room Owner";
      badges.append(badge);
    }
    if (client.isGameModerator) {
      const badge = document.createElement("span");
      badge.textContent = "Storyteller";
      badges.append(badge);
    }

    const revisions = document.createElement("div");
    revisions.className = "player-detail";
    revisions.textContent =
      "room rev " + (client.roomRevision ?? "—") +
      " · player rev " + (client.playerRevision ?? "—") +
      " · gen " + client.generation;

    const actions = document.createElement("div");
    actions.className = "player-actions";
    actions.append(createButton("查看此手机", () => {
      selectedPlayerId = client.playerId;
      render();
    }, "primary"));

    if (client.connectionStatus === "Disconnected") {
      actions.append(createButton("重新连接", async () => {
        try {
          await post("/dev/simulator/api/reconnect", { playerId: client.playerId });
          setStatus(client.name + " 已重新连接并同步 authoritative state。", "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      }));
    } else if (client.connectionStatus === "Connected") {
      actions.append(createButton("模拟掉线", async () => {
        try {
          await post("/dev/simulator/api/disconnect", { playerId: client.playerId });
          setStatus(client.name + " 已模拟网络掉线。", "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      }));
    }

    card.append(head, badges, revisions, actions);
    return card;
  });

  elements.players.replaceChildren(...cards);
}

function renderInspector(client) {
  elements.roomProjection.textContent = pretty(client ? client.roomProjection : null);
  elements.playerView.textContent = pretty(client ? client.playerView : null);
  elements.trace.textContent = (client ? client.trace : [])
    .slice(-24)
    .map(entry => {
      const revision = entry.revision === undefined ? "" : " rev=" + entry.revision;
      const detail = entry.detail ? " " + entry.detail : "";
      return "#" + entry.sequence + " " + entry.event + " gen=" + entry.generation + revision + detail;
    })
    .join("\n");
}

function render() {
  const initialized = Boolean(simulatorState && simulatorState.initialized);
  elements.roomId.textContent = simulatorState && simulatorState.roomId ? simulatorState.roomId : "—";
  elements.roomRevision.textContent = String(
    simulatorState && simulatorState.roomRevision !== null ? simulatorState.roomRevision : "—",
  );
  elements.sendCommand.disabled = !initialized;
  elements.setModerator.disabled = !initialized;
  elements.automaticModerator.disabled = !initialized;
  elements.viewerSelect.disabled = !initialized;
  elements.moderatorSelect.disabled = !initialized;

  syncSelections();
  const client = selectedClient();
  renderPhone(client);
  renderVirtualPlayers();
  renderInspector(client);
}

elements.reset.addEventListener("click", async () => {
  const playerCount = Number(elements.playerCount.value);
  elements.reset.disabled = true;
  setStatus("正在建立 " + playerCount + " 人 BotC Simulator room…");
  try {
    simulatorState = await post("/dev/simulator/api/reset", { playerCount });
    selectedPlayerId = simulatorState.clients[0] ? simulatorState.clients[0].playerId : "";
    render();
    setStatus(
      "Simulator room " + simulatorState.roomId + " 已建立：" +
        simulatorState.playerCount + " 个独立 ClientSession。",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.reset.disabled = false;
  }
});

elements.viewerSelect.addEventListener("change", () => {
  selectedPlayerId = elements.viewerSelect.value;
  render();
});

elements.setModerator.addEventListener("click", async () => {
  try {
    simulatorState = await post("/dev/simulator/api/moderator", {
      playerId: elements.moderatorSelect.value || null,
    });
    render();
    setStatus("Game Moderator assignment 已通过 production semantic command 更新。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.automaticModerator.addEventListener("click", async () => {
  try {
    simulatorState = await post("/dev/simulator/api/moderator", { playerId: null });
    render();
    setStatus("已恢复 Automatic Storyteller。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.sendCommand.addEventListener("click", async () => {
  const client = selectedClient();
  if (!client) return;
  let payload;
  try {
    payload = JSON.parse(elements.commandPayload.value || "{}");
  } catch {
    setStatus("Command payload 必须是合法 JSON。", "error");
    return;
  }

  try {
    const response = await post("/dev/simulator/api/command", {
      playerId: client.playerId,
      type: elements.commandType.value,
      payload,
    });
    simulatorState = response.state;
    render();
    setStatus(client.name + " 已通过 ClientSession 发送 semantic command。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

async function initialize() {
  try {
    const response = await fetch("/dev/simulator/api/state", { cache: "no-store" });
    simulatorState = await response.json();
    render();

    const events = new EventSource("/dev/simulator/api/events");
    events.onmessage = event => {
      simulatorState = JSON.parse(event.data);
      render();
    };
    events.onerror = () => {
      setStatus("Simulator event stream 暂时中断；刷新页面可重新连接。", "error");
    };
  } catch (error) {
    setStatus(error.message, "error");
  }
}

void initialize();
