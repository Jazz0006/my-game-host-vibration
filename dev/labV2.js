import { createBotcGamePresentation } from "/client-runtime/client/BotcGamePresentation.js";

const elements = {
  playerCount: document.querySelector("#player-count"),
  reset: document.querySelector("#reset-simulator"),
  roomId: document.querySelector("#room-id"),
  roomRevision: document.querySelector("#room-revision"),
  status: document.querySelector("#simulator-status"),
  viewerSelect: document.querySelector("#viewer-select"),
  phoneProductView: document.querySelector("#phone-product-view"),
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

function phoneElement(tag, className, text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

async function sendPhoneCommand(client, type, payload = {}) {
  try {
    const response = await post("/dev/simulator/api/command", {
      playerId: client.playerId,
      type,
      payload,
    });
    simulatorState = response.state;
    render();
    setStatus(client.name + " 已通过镜像界面发送 " + type + "。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function presentationForClient(client) {
  const selected = client._selectedNightChoiceIds || [];
  const first = createBotcGamePresentation({
    room: client.roomProjection,
    playerView: client.playerView,
    connectionStatus: client.connectionStatus,
    selectedNightChoiceIds: selected,
  });
  if (client._nightChoiceKey !== first.nightChoiceKey) {
    client._nightChoiceKey = first.nightChoiceKey;
    client._selectedNightChoiceIds = [];
  }
  return createBotcGamePresentation({
    room: client.roomProjection,
    playerView: client.playerView,
    connectionStatus: client.connectionStatus,
    selectedNightChoiceIds: client._selectedNightChoiceIds || [],
  });
}

function appendInfoCard(root, eyebrow, lines) {
  const card = phoneElement("section", "wechat-card wechat-private-card");
  card.append(phoneElement("div", "wechat-eyebrow", eyebrow));
  for (const line of lines.filter(Boolean)) {
    card.append(phoneElement("div", "wechat-info-line", line));
  }
  root.append(card);
  return card;
}

function appendAction(root, label, enabled, onClick, secondary = false) {
  if (!enabled) return;
  const button = createButton(label, onClick, secondary ? "wechat-button secondary" : "wechat-button primary");
  root.append(button);
}

function renderPhone(client) {
  const root = elements.phoneProductView;
  root.replaceChildren();

  if (!client) {
    root.append(phoneElement(
      "div",
      "phone-empty",
      "建立模拟桌后，这里会按微信游戏页的共享 presentation model 渲染当前 Viewer。",
    ));
    return;
  }

  const room = client.roomProjection;
  if (!room || !room.gameStarted) {
    const header = phoneElement("div", "wechat-topbar");
    const title = phoneElement("div", "wechat-title-block");
    title.append(
      phoneElement("div", "wechat-eyebrow", "GAME"),
      phoneElement("div", "wechat-title", "血染钟楼"),
    );
    header.append(title, phoneElement("div", "wechat-phase-pill", "大厅"));
    root.append(header);
    root.append(phoneElement(
      "section",
      "wechat-card wechat-role-card",
      "游戏尚未开始。Simulator 的房间控制仍由右侧/中间开发控制面板负责；进入游戏后这里切换为微信 game page 镜像。",
    ));
    root.append(phoneElement(
      "div",
      "wechat-privacy-note",
      clientLabel(client) + " · Room " + (room.roomId || "—"),
    ));
    return;
  }

  const presentation = presentationForClient(client);
  const header = phoneElement("div", "wechat-topbar");
  const title = phoneElement("div", "wechat-title-block");
  title.append(
    phoneElement("div", "wechat-eyebrow", "GAME"),
    phoneElement("div", "wechat-title", "血染钟楼"),
  );
  header.append(title, phoneElement("div", "wechat-phase-pill", presentation.phaseLabel));
  root.append(header);

  if (presentation.connectionStatus) {
    root.append(phoneElement("div", "wechat-connection-line", presentation.connectionStatus));
  }

  if (!presentation.isSpectator) {
    const roleCard = phoneElement("section", "wechat-card wechat-role-card");
    roleCard.append(
      phoneElement("div", "wechat-eyebrow", "YOUR ROLE"),
      phoneElement("div", "wechat-role-name", presentation.roleName || "等待身份信息"),
    );
    if (presentation.roleCategory) {
      roleCard.append(phoneElement("div", "wechat-role-category", presentation.roleCategory));
    }
    if (presentation.roleConfirmed) {
      roleCard.append(phoneElement("div", "wechat-confirmed-badge", "✓ 已确认"));
    }
    root.append(roleCard);
  } else {
    const storyteller = phoneElement("section", "wechat-card wechat-storyteller-card");
    storyteller.append(
      phoneElement("div", "wechat-eyebrow", "STORYTELLER"),
      phoneElement("div", "wechat-section-title", "你是本局说书人"),
      phoneElement("div", "wechat-copy", "你不参与角色分配。请根据 authoritative ModeratorView 主持当前阶段。"),
    );
    if (presentation.moderatorStepId) {
      const step = phoneElement("div", "wechat-night-step");
      step.append(phoneElement("div", "", "当前夜间步骤：" + presentation.moderatorStepId));
      if (presentation.moderatorActorNames) {
        step.append(phoneElement("div", "", "行动玩家：" + presentation.moderatorActorNames));
      }
      storyteller.append(step);
    }
    root.append(storyteller);
  }

  if (presentation.isNightWake) {
    const wake = phoneElement("section", "wechat-card wechat-night-card wake");
    wake.append(
      phoneElement("div", "wechat-eyebrow", "WAKE"),
      phoneElement("div", "wechat-night-title", "请睁眼"),
    );
    if (presentation.nightStepId) {
      wake.append(phoneElement("div", "wechat-copy", "当前步骤：" + presentation.nightStepId));
    }
    root.append(wake);
  }

  if (presentation.isNightWaiting) {
    const wait = phoneElement("section", "wechat-card wechat-night-card waiting");
    wait.append(
      phoneElement("div", "wechat-eyebrow", "WAIT"),
      phoneElement("div", "wechat-night-title", "请闭眼等待"),
      phoneElement("div", "wechat-copy", "轮到你时手机会震动并显示私密信息。"),
    );
    root.append(wait);
  }

  if (presentation.nightChoiceOptions.length) {
    const choice = phoneElement("section", "wechat-card wechat-choice-card");
    choice.append(
      phoneElement("div", "wechat-eyebrow", "NIGHT CHOICE"),
      phoneElement("div", "wechat-section-title", "请选择玩家"),
      phoneElement(
        "div",
        "wechat-copy",
        "需要选择 " + presentation.nightChoiceMinTargets + "–" + presentation.nightChoiceMaxTargets + " 人",
      ),
    );
    const grid = phoneElement("div", "wechat-choice-grid");
    for (const option of presentation.nightChoiceOptions) {
      grid.append(createButton(option.name, () => {
        const selected = [...(client._selectedNightChoiceIds || [])];
        const index = selected.indexOf(option.id);
        if (index >= 0) {
          selected.splice(index, 1);
        } else if (presentation.nightChoiceMaxTargets === 1) {
          selected.splice(0, selected.length, option.id);
        } else if (selected.length < presentation.nightChoiceMaxTargets) {
          selected.push(option.id);
        }
        client._selectedNightChoiceIds = selected;
        renderPhone(client);
      }, "wechat-choice-option" + (option.selected ? " selected" : "")));
    }
    choice.append(grid);
    const refreshed = presentationForClient(client);
    appendAction(
      choice,
      "确认选择",
      refreshed.canSubmitNightChoice,
      () => sendPhoneCommand(client, "botc.submitNightChoice", {
        playerIds: [...(client._selectedNightChoiceIds || [])],
      }),
    );
    root.append(choice);
  }

  if (presentation.minionDemonName) {
    appendInfoCard(root, "MINION INFO", [
      "恶魔：" + presentation.minionDemonName,
      presentation.fellowMinionNames ? "其他爪牙：" + presentation.fellowMinionNames : "",
    ]);
  }
  if (presentation.demonMinionNames || presentation.demonBluffNames) {
    appendInfoCard(root, "DEMON INFO", [
      presentation.demonMinionNames ? "爪牙：" + presentation.demonMinionNames : "",
      presentation.demonBluffNames ? "三个伪装身份：" + presentation.demonBluffNames : "",
    ]);
  }
  if (presentation.privateInformationRoleName || presentation.privateInformationZeroLabel) {
    const card = appendInfoCard(root, "PRIVATE INFO", [
      presentation.privateInformationRoleName
        ? presentation.privateInformationPlayerNames + " 中有 1 人是 " + presentation.privateInformationRoleName
        : presentation.privateInformationZeroLabel,
    ]);
    appendAction(
      card,
      "我记住这条信息了",
      presentation.canAcknowledgeNightInformation,
      () => sendPhoneCommand(client, "botc.acknowledgeNightInformation"),
    );
  }

  const progress = phoneElement("section", "wechat-card wechat-progress-card");
  progress.append(
    phoneElement("span", "wechat-progress-label", "身份确认进度"),
    phoneElement("strong", "wechat-progress-value", presentation.confirmedRoles + " / " + presentation.playerCount),
  );
  if (presentation.allConfirmed) {
    progress.append(phoneElement("div", "wechat-progress-note", "所有玩家已确认"));
  }
  root.append(progress);
  root.append(phoneElement("div", "wechat-status-line", presentation.statusLine));

  appendAction(
    root,
    "我知道自己的身份了",
    presentation.canConfirmRole,
    () => sendPhoneCommand(client, "botc.confirmRole"),
  );
  appendAction(
    root,
    "开始首夜",
    presentation.canBeginFirstNight,
    () => sendPhoneCommand(client, "botc.beginFirstNight"),
  );
  appendAction(
    root,
    "提交当前私密信息",
    presentation.canCommitNightInformation,
    () => sendPhoneCommand(client, "botc.commitNightInformation"),
  );
  appendAction(
    root,
    "完成当前夜间步骤",
    presentation.canCompleteNightStep,
    () => sendPhoneCommand(client, "botc.completeNightStep"),
    true,
  );

  if (!presentation.isSpectator) {
    root.append(phoneElement(
      "div",
      "wechat-privacy-note",
      "本页只显示服务器为当前玩家生成的 authoritative PlayerView。",
    ));
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
