import { createBotcGamePresentation } from "/client-runtime/client/BotcGamePresentation.js";
import { createClientLobbyPresentation } from "/client-runtime/client/ClientLobbyPresentation.js";
import {
  createClientEntryPresentation,
  normalizeClientRoomCode,
} from "/client-runtime/client/ClientEntryPresentation.js";
import {
  computeRoundedTableSeats,
} from "/client-runtime/client/RoundedTableLayout.js";
import {
  bindModeratorLongPressDrag,
  bindSeatLongPressDrag,
} from "/dev/assets/wechatReferenceInteractions.js";

const BOTC_PRODUCT = {
  appName: "骏骏桌游-血染",
  gameLabel: "血染钟楼",
  moderatorLabel: "说书人",
};

const elements = {
  playerCount: document.querySelector("#player-count"),
  resetDevices: document.querySelector("#reset-devices"),
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
let selectedDeviceLabel = "";
const phoneSubpageByDevice = new Map();

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
    ? simulatorState.clients.find(client => client.label === selectedDeviceLabel) || null
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
  if (!client.joined) return client.label + " · " + client.name + " · 未加入房间";
  const seat = client.seat === null ? "?" : client.seat;
  const roles = [
    client.isHost ? "Owner" : "",
    client.isGameModerator ? "Storyteller" : "",
  ].filter(Boolean);
  return seat + "号 " + client.name + (roles.length ? " · " + roles.join(" / ") : "");
}

function syncSelections() {
  const clients = simulatorState && simulatorState.clients ? simulatorState.clients : [];
  if (!clients.some(client => client.label === selectedDeviceLabel)) {
    selectedDeviceLabel = clients[0] ? clients[0].label : "";
  }

  const viewerOptions = clients.map(client => new Option(clientLabel(client), client.label));
  elements.viewerSelect.replaceChildren(...viewerOptions);
  elements.viewerSelect.value = selectedDeviceLabel;

  const joinedClients = clients.filter(client => client.joined && client.playerId);
  const automatic = new Option("自动说书人", "");
  const moderatorOptions = joinedClients.map(client => new Option(clientLabel(client), client.playerId));
  elements.moderatorSelect.replaceChildren(automatic, ...moderatorOptions);
  const humanModerator = joinedClients.find(client => client.isGameModerator);
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
  const selectedRedHerringPlayerId = client._selectedRedHerringPlayerId || "";
  const first = createBotcGamePresentation({
    room: client.roomProjection,
    playerView: client.playerView,
    connectionStatus: client.connectionStatus,
    selectedNightChoiceIds: selected,
    selectedRedHerringPlayerId,
  });
  if (client._nightChoiceKey !== first.nightChoiceKey) {
    client._nightChoiceKey = first.nightChoiceKey;
    client._selectedNightChoiceIds = [];
  }
  if (client._redHerringKey !== first.redHerringKey) {
    client._redHerringKey = first.redHerringKey;
    client._selectedRedHerringPlayerId = "";
  }
  return createBotcGamePresentation({
    room: client.roomProjection,
    playerView: client.playerView,
    connectionStatus: client.connectionStatus,
    selectedNightChoiceIds: client._selectedNightChoiceIds || [],
    selectedRedHerringPlayerId: client._selectedRedHerringPlayerId || "",
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

function createTextInput(value, placeholder, className = "wechat-input") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.className = className;
  return input;
}

function renderEntryPhone(root, client) {
  root.className = "wechat-product-page wechat-index-page";

  const hero = phoneElement("section", "wechat-index-hero");
  hero.append(
    phoneElement("div", "wechat-index-brand-mark", "桌"),
    phoneElement("div", "wechat-index-title", BOTC_PRODUCT.appName),
    phoneElement("div", "wechat-index-subtitle", "一起玩桌游，更轻松"),
  );
  root.append(hero);

  const card = phoneElement("section", "wechat-index-main-card");
  card.append(createButton("创建房间", async () => {
    try {
      simulatorState = await post("/dev/simulator/api/room/create", {
        label: client.label,
        name: client.name,
      });
      phoneSubpageByDevice.set(client.label, "lobby");
      render();
      setStatus(client.label + " 已通过 production bootstrap 创建房间。", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }, "wechat-index-create-button"));

  card.append(phoneElement("div", "wechat-index-join-label", "加入房间"));
  const joinRow = phoneElement("div", "wechat-index-join-row");
  const roomInput = createTextInput("", "4 位房间号", "wechat-index-room-input");
  roomInput.maxLength = 4;
  roomInput.inputMode = "numeric";
  roomInput.type = "number";
  const join = createButton("加入", async () => {
    const entry = createClientEntryPresentation({
      roomCode: normalizeClientRoomCode(roomInput.value),
      hasRecoverableRoom: client.recoverable,
    });
    if (!entry.canJoinRoom) {
      setStatus("请输入 4 位房间号", "error");
      return;
    }
    try {
      simulatorState = await post("/dev/simulator/api/room/join", {
        label: client.label,
        name: client.name,
        roomCode: entry.roomCode,
      });
      phoneSubpageByDevice.set(client.label, "lobby");
      render();
      setStatus(client.label + " 已通过 production bootstrap 加入房间。", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }, "wechat-index-join-button");
  joinRow.append(roomInput, join);
  card.append(joinRow);

  if (client.recoverable) {
    card.append(createButton("继续上次房间", async () => {
      try {
        simulatorState = await post("/dev/simulator/api/device/continue", {
          label: client.label,
        });
        phoneSubpageByDevice.set(client.label, "lobby");
        render();
        setStatus(client.label + " 已从保存凭证恢复上次房间。", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }, "wechat-index-continue-button"));
  }
  root.append(card);

  const developer = phoneElement("section", "wechat-index-developer-card");
  developer.append(
    phoneElement("div", "wechat-index-developer-title", "开发阶段快捷入口"),
    phoneElement(
      "div",
      "wechat-index-developer-copy",
      "Diagnostics 保留 E3.7 真机 lifecycle 验证；桌面 UI 与多客户端调试统一使用 Simulator Lab V2。",
    ),
    createButton("E3.7 Diagnostics", () => {
      setStatus("Simulator Lab 中请使用右侧 Inspector；真机 Diagnostics 仍在微信 Developer Tools 中验收。");
    }, "wechat-index-diagnostics-button"),
  );
  root.append(developer);
}

function renderSettingsPhone(root, client, model) {
  root.className = "wechat-product-page wechat-settings-page";
  root.append(phoneElement("div", "wechat-settings-title", "设置"));

  const tabs = phoneElement("div", "wechat-settings-tabs");
  tabs.append(phoneElement("div", "wechat-settings-tab active", "房间管理"));
  root.append(tabs);
  root.append(phoneElement("div", "wechat-settings-room-meta", "房间 " + (model.roomCode || "----")));

  const section = phoneElement("section", "wechat-settings-section");
  section.append(phoneElement("div", "wechat-settings-section-title", "房间成员"));
  for (const participant of model.participants) {
    const row = phoneElement("div", "wechat-settings-member-row");
    const main = phoneElement("div", "wechat-settings-member-main");
    const name = phoneElement("div", "wechat-settings-member-name");
    name.append(document.createTextNode(participant.seat + "号 · " + participant.name));
    if (participant.isOwner) {
      name.append(phoneElement("span", "wechat-settings-owner-label", "房主"));
    }
    main.append(
      name,
      phoneElement(
        "div",
        "wechat-settings-member-meta",
        participant.connected
          ? participant.ready ? "在线 · 已准备" : "在线 · 未准备"
          : "暂时离线",
      ),
    );
    row.append(main);

    if (model.isOwner && participant.id !== model.currentPlayerId) {
      const actions = phoneElement("div", "wechat-settings-member-actions");
      const transfer = createButton("移交房主", async () => {
        if (!participant.connected) return;
        const confirmed = window.confirm(
          "确定把房主移交给 " + participant.name + "？说书人/法官 assignment 不会改变。",
        );
        if (confirmed) {
          await sendPhoneCommand(client, "room.transferHost", {
            targetPlayerId: participant.id,
          });
        }
      }, "wechat-settings-mini-button");
      transfer.disabled = !participant.connected;
      actions.append(transfer);

      const remove = createButton("移出", async () => {
        if (model.gameStarted) return;
        const confirmed = window.confirm("确定将 " + participant.name + " 移出房间？");
        if (confirmed) {
          await sendPhoneCommand(client, "room.removePlayer", {
            targetPlayerId: participant.id,
          });
        }
      }, "wechat-settings-mini-button warn");
      remove.disabled = model.gameStarted;
      actions.append(remove);
      row.append(actions);
    }
    section.append(row);
  }
  root.append(section);

  if (!model.isOwner) {
    root.append(phoneElement(
      "div",
      "wechat-settings-read-only-note",
      "当前你不是 Room Owner；这里仅显示 authoritative 房间状态。",
    ));
  }
  root.append(phoneElement(
    "div",
    "wechat-settings-footnote",
    "Room Owner 与游戏主持人是独立职责；移交房主不会改变说书人/法官 assignment。若移出当前人工主持人，服务器会自动恢复 Automatic。",
  ));

  const nativeBack = createButton("‹", () => {
    phoneSubpageByDevice.set(client.label, "lobby");
    renderPhone(client);
  }, "wechat-native-back");
  nativeBack.title = "模拟微信原生返回";
  root.append(nativeBack);
}

function renderLobbyPhone(root, client) {
  const model = createClientLobbyPresentation(client.roomProjection);
  if (phoneSubpageByDevice.get(client.label) === "settings") {
    renderSettingsPhone(root, client, model);
    return;
  }

  root.className = "wechat-product-page wechat-lobby-page";

  const header = phoneElement("div", "wechat-lobby-topbar");
  const title = phoneElement("div", "");
  title.append(
    phoneElement("div", "wechat-lobby-eyebrow", "ROOM"),
    phoneElement("div", "wechat-lobby-room-title", "房间 " + (model.roomCode || "----")),
  );
  header.append(
    title,
    createButton("⚙", () => {
      phoneSubpageByDevice.set(client.label, "settings");
      renderPhone(client);
    }, "wechat-lobby-icon-button"),
  );
  root.append(header);

  const table = phoneElement("section", "wechat-lobby-table-stage");
  const byId = Object.fromEntries(model.participants.map(participant => [participant.id, participant]));
  const seats = computeRoundedTableSeats(model.playerOrder, byId);
  const seatElements = [];
  for (const seat of seats) {
    const seatElement = phoneElement(
      "div",
      "wechat-lobby-seat" +
        (seat.ready ? " ready" : "") +
        (seat.connected === false ? " offline" : ""),
    );
    seatElement.style.left = (seat.xRpx / 2) + "px";
    seatElement.style.top = (seat.yRpx / 2) + "px";
    const name = phoneElement("div", "wechat-lobby-seat-name", seat.name || seat.id);
    if (seat.isOwner) {
      name.append(phoneElement("span", "wechat-lobby-owner-badge", "👑"));
    }
    seatElement.append(
      name,
      phoneElement("div", "wechat-lobby-seat-state", seat.ready ? "✓ 已准备" : "未准备"),
    );
    table.append(seatElement);
    seatElements.push({ seat, element: seatElement });
  }

  const center = phoneElement("div", "wechat-lobby-table-center");
  const moderator = phoneElement("div", "wechat-lobby-moderator-card");
  moderator.append(
    phoneElement("div", "wechat-lobby-moderator-role", BOTC_PRODUCT.moderatorLabel),
    phoneElement("div", "wechat-lobby-moderator-name", model.moderatorName),
  );
  if (model.isOwner && !model.gameStarted) {
    moderator.append(phoneElement(
      "div",
      "wechat-lobby-moderator-hint",
      model.moderatorName === "自动" ? "长按玩家拖到这里" : "长按主持位拖回桌边",
    ));
  }
  center.append(
    moderator,
    phoneElement("div", "wechat-lobby-divider"),
  );
  const gameList = phoneElement("div", "wechat-lobby-game-list");
  gameList.append(phoneElement("div", "wechat-lobby-game-option selected", BOTC_PRODUCT.gameLabel));
  center.append(gameList);
  table.append(center);
  root.append(table);
  for (const item of seatElements) {
    bindSeatLongPressDrag(
      item.element,
      moderator,
      table,
      client,
      model,
      item.seat,
      sendPhoneCommand,
    );
  }
  bindModeratorLongPressDrag(moderator, table, client, model, sendPhoneCommand);

  root.append(phoneElement("div", "wechat-lobby-status-line", model.statusLine));

  if (!model.gameStarted && (model.isOwner || model.canControlGame)) {
    const actions = phoneElement("div", "wechat-lobby-host-actions");
    if (model.isOwner) {
      actions.append(createButton("邀请朋友", () => {
        setStatus("房间号：" + model.roomCode, "success");
      }, "wechat-lobby-secondary-button"));
    }
    if (model.canControlGame) {
      actions.append(createButton(
        "开始游戏",
        () => sendPhoneCommand(client, "botc.startGame"),
        "wechat-lobby-primary-button",
      ));
    }
    root.append(actions);
  }

  if (!model.isGameModerator) {
    root.append(createButton(
      model.currentPlayerReady ? "✓ 已准备好" : "已准备好",
      () => {
        const nextReady = !model.currentPlayerReady;
        void sendPhoneCommand(client, "room.setReady", { ready: nextReady });
        if (nextReady) {
          setStatus(client.name + "：微信真机会在首次 Ready 时触发 heavy vibration；Lab 仅记录 capability event。");
        }
      },
      "wechat-lobby-ready-button" + (model.currentPlayerReady ? " active" : ""),
    ));
  }
}

function renderPhone(client) {
  const root = elements.phoneProductView;
  root.replaceChildren();
  if (!client) {
    root.className = "wechat-product-page wechat-empty-page";
    root.append(phoneElement(
      "div",
      "phone-empty",
      "建立虚拟设备后，这里会从微信入口页开始镜像当前客户端。",
    ));
    return;
  }

  if (!client.joined || !client.roomProjection) {
    renderEntryPhone(root, client);
    return;
  }

  const room = client.roomProjection;
  if (!room.gameStarted) {
    renderLobbyPhone(root, client);
    return;
  }

  root.className = "wechat-product-page wechat-game-page";
  const presentation = presentationForClient(client);
  const header = phoneElement("div", "wechat-topbar");
  const title = phoneElement("div", "wechat-title-block");
  title.append(
    phoneElement("div", "wechat-eyebrow", "GAME"),
    phoneElement("div", "wechat-title", BOTC_PRODUCT.gameLabel),
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

  if (presentation.redHerringOptions.length) {
    const setup = phoneElement("section", "wechat-card wechat-choice-card");
    setup.append(
      phoneElement("div", "wechat-eyebrow", "STORYTELLER SETUP"),
      phoneElement("div", "wechat-section-title", "选择占卜师的红鲱鱼"),
      phoneElement("div", "wechat-copy", "必须选择 1 名实际善良玩家；占卜师不会看到这项设置。"),
    );
    const grid = phoneElement("div", "wechat-choice-grid");
    for (const option of presentation.redHerringOptions) {
      grid.append(createButton(option.name, () => {
        client._selectedRedHerringPlayerId = option.id;
        renderPhone(client);
      }, "wechat-choice-option" + (option.selected ? " selected" : "")));
    }
    setup.append(grid);
    const refreshed = presentationForClient(client);
    const confirmRedHerring = createButton(
      "确认红鲱鱼",
      () => sendPhoneCommand(client, "botc.setRedHerring", {
        playerId: refreshed.redHerringSelectedPlayerId,
      }),
      "wechat-button primary",
    );
    confirmRedHerring.disabled = !refreshed.canSetRedHerring;
    setup.append(confirmRedHerring);
    root.append(setup);
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
    const confirmChoice = createButton(
      "确认选择",
      () => sendPhoneCommand(client, "botc.submitNightChoice", {
        playerIds: [...(client._selectedNightChoiceIds || [])],
      }),
      "wechat-button primary",
    );
    confirmChoice.disabled = !refreshed.canSubmitNightChoice;
    choice.append(confirmChoice);
    root.append(choice);
  }

  if (presentation.isDay && presentation.dayNominationOptions.length) {
    const nomination = phoneElement("section", "wechat-card wechat-choice-card");
    nomination.append(
      phoneElement("div", "wechat-eyebrow", "NOMINATION"),
      phoneElement("div", "wechat-section-title", "选择提名对象"),
      phoneElement("div", "wechat-copy", "你今天只能提名一次；同一玩家今天只能被提名一次。"),
    );
    const grid = phoneElement("div", "wechat-choice-grid");
    for (const option of presentation.dayNominationOptions) {
      grid.append(createButton(
        option.name,
        () => sendPhoneCommand(client, "botc.nominate", {
          nomineePlayerId: option.id,
        }),
        "wechat-choice-option",
      ));
    }
    nomination.append(grid);
    root.append(nomination);
  }

  if (presentation.isDay && presentation.dayNominationId) {
    const vote = appendInfoCard(root, "VOTE", [
      presentation.dayNominatorName + " 提名 " + presentation.dayNomineeName,
      "当前 " + presentation.dayVoteCount + " 票 · 上台门槛 " + presentation.dayVoteThreshold + " 票",
      presentation.dayYesVoterNames ? "赞成：" + presentation.dayYesVoterNames : "",
      presentation.ghostVoteSpent ? "你的幽灵票已在此前使用。" : "",
    ]);
    appendAction(
      vote,
      presentation.myDayVoteYes ? "维持赞成" : "投赞成票",
      presentation.canSubmitDayVoteYes,
      () => sendPhoneCommand(client, "botc.submitDayVote", { vote: true }),
    );
    appendAction(
      vote,
      "不赞成 / 撤回赞成",
      presentation.canSubmitDayVoteNo,
      () => sendPhoneCommand(client, "botc.submitDayVote", { vote: false }),
      true,
    );
    appendAction(
      vote,
      "结束本次投票",
      presentation.canCloseNomination,
      () => sendPhoneCommand(client, "botc.closeNomination"),
      true,
    );
  }

  if (presentation.isDay && presentation.dayHighVoteCount) {
    appendInfoCard(root, "VOTE STATUS", [
      presentation.dayTiedAtHigh
        ? "最高票 " + presentation.dayHighVoteCount + " · 当前平票"
        : "当前最高票候选：" + presentation.dayBlockNomineeName,
      presentation.dayTiedAtHigh ? "" : presentation.dayHighVoteCount + " 票",
    ]);
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
  if (presentation.spyGrimoireRows.length) {
    const lines = presentation.spyGrimoireRows.map(row =>
      "#" + row.seat + " " + row.name + " · " + (row.alive ? "存活" : "死亡") +
      " · " + row.roleName + (row.shownRoleName ? "（展示：" + row.shownRoleName + "）" : ""),
    );
    lines.push(...presentation.spyGrimoireReminderLines);
    const grimoire = appendInfoCard(root, "GRIMOIRE", lines);
    appendAction(
      grimoire,
      "我看完魔典了",
      presentation.canAcknowledgeNightInformation,
      () => sendPhoneCommand(client, "botc.acknowledgeNightInformation"),
    );
  }

  if (
    presentation.privateInformationRoleName ||
    presentation.privateInformationZeroLabel ||
    presentation.privateInformationNumber !== null ||
    presentation.privateInformationBooleanLabel
  ) {
    const card = appendInfoCard(root, "PRIVATE INFO", [
      presentation.privateInformationRoleName
        ? presentation.privateInformationPlayerNames + " 中有 1 人是 " + presentation.privateInformationRoleName
        : "",
      presentation.privateInformationZeroLabel || "",
      presentation.privateInformationNumber !== null
        ? "你得知的数字是 " + presentation.privateInformationNumber
        : "",
      presentation.privateInformationBooleanLabel
        ? "占卜结果：" + presentation.privateInformationBooleanLabel
        : "",
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
    "进入下一夜",
    presentation.canBeginOtherNight,
    () => sendPhoneCommand(client, "botc.beginOtherNight"),
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
      (client.connectionStatus === "Connected" || !client.joined ? "" : " offline") +
      (client.label === selectedDeviceLabel ? " selected" : "");

    const head = document.createElement("div");
    head.className = "player-head";
    const seat = document.createElement("span");
    seat.className = "seat";
    seat.textContent = client.joined ? String(client.seat ?? "?") : "—";
    const title = document.createElement("div");
    title.className = "player-title";
    const name = document.createElement("strong");
    name.textContent = client.label + " · " + client.name;
    const id = document.createElement("small");
    id.textContent = client.joined ? shortId(client.playerId) : "未加入房间";
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
      selectedDeviceLabel = client.label;
      render();
    }, "primary"));

    if (client.connectionStatus === "Disconnected") {
      actions.append(createButton("重新连接", async () => {
        try {
          simulatorState = await post("/dev/simulator/api/reconnect", { playerId: client.playerId });
          render();
          setStatus(client.name + " 已重新连接并同步 authoritative state。", "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      }));
    } else if (client.connectionStatus === "Connected") {
      actions.append(createButton("模拟掉线", async () => {
        try {
          simulatorState = await post("/dev/simulator/api/disconnect", { playerId: client.playerId });
          render();
          setStatus(client.name + " 已模拟网络掉线。", "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      }));
      actions.append(createButton("模拟关闭微信", async () => {
        try {
          simulatorState = await post("/dev/simulator/api/device/close", { label: client.label });
          phoneSubpageByDevice.delete(client.label);
          render();
          setStatus(client.name + " 已关闭当前 session；可从入口页“继续上次房间”。", "success");
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

  syncSelections();
  const client = selectedClient();
  const joined = Boolean(client && client.joined && client.playerId);
  const hasRoom = Boolean(simulatorState && simulatorState.roomId);

  elements.sendCommand.disabled = !joined;
  elements.setModerator.disabled = !hasRoom;
  elements.automaticModerator.disabled = !hasRoom;
  elements.viewerSelect.disabled = !initialized;
  elements.moderatorSelect.disabled = !hasRoom;

  renderPhone(client);
  renderVirtualPlayers();
  renderInspector(client);
}

elements.resetDevices.addEventListener("click", async () => {
  const deviceCount = Number(elements.playerCount.value);
  elements.resetDevices.disabled = true;
  setStatus("正在建立 " + deviceCount + " 台未进房虚拟微信客户端…");
  try {
    simulatorState = await post("/dev/simulator/api/devices/reset", { deviceCount });
    selectedDeviceLabel = simulatorState.clients[0] ? simulatorState.clients[0].label : "";
    phoneSubpageByDevice.clear();
    render();
    setStatus(
      "完整客户端模式已建立：" + simulatorState.playerCount +
        " 台设备均从微信入口页开始。",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.resetDevices.disabled = false;
  }
});

elements.reset.addEventListener("click", async () => {
  const playerCount = Number(elements.playerCount.value);
  if (!Number.isInteger(playerCount) || playerCount < 5 || playerCount > 15) {
    setStatus("快速 BotC 模拟桌需要 5–15 名玩家。", "error");
    return;
  }
  elements.reset.disabled = true;
  setStatus("正在快速建立 " + playerCount + " 人 BotC Simulator room…");
  try {
    simulatorState = await post("/dev/simulator/api/reset", { playerCount });
    selectedDeviceLabel = simulatorState.clients[0] ? simulatorState.clients[0].label : "";
    phoneSubpageByDevice.clear();
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
  selectedDeviceLabel = elements.viewerSelect.value;
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
  if (!client || !client.joined || !client.playerId) return;
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
