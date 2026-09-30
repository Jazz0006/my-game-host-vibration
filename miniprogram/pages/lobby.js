const {
  TABLE_WIDTH_RPX,
  TABLE_HEIGHT_RPX,
  computeRoundedTableSeats,
  resolveRoundedTableRingIndex,
} = require("../rounded-table-layout.js");
function toParticipantMap(participants) {
  const result = {};
  for (const participant of participants || []) {
    result[participant.id] = participant;
  }
  return result;
}

function movePlayerId(order, playerId, targetIndex) {
  const next = (Array.isArray(order) ? order : []).filter(id => id !== playerId);
  const index = Math.max(0, Math.min(Number(targetIndex) || 0, next.length));
  next.splice(index, 0, playerId);
  return next;
}

function eventPoint(event) {
  const touch =
    (event.touches && event.touches[0]) ||
    (event.changedTouches && event.changedTouches[0]);
  if (!touch) return null;
  const x = Number(touch.clientX !== undefined ? touch.clientX : touch.pageX);
  const y = Number(touch.clientY !== undefined ? touch.clientY : touch.pageY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function containsPoint(rect, point) {
  return Boolean(
    rect &&
      point &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
  );
}

function canonicalModeratorAssignment(value) {
  if (value && value.mode === "human" && value.playerId) {
    return { mode: "human", playerId: value.playerId };
  }
  return { mode: "automatic" };
}

function authoritativeLobbyModel(room) {
  const players = Array.isArray(room.players)
    ? [...room.players].sort((left, right) => left.seat - right.seat)
    : [];
  const owner = players.find(player => player.isHost);
  const moderatorAssignment = canonicalModeratorAssignment(room.gameModerator);
  const moderatorPlayerId =
    moderatorAssignment.mode === "human" ? moderatorAssignment.playerId : "";
  const viewer = room.viewer || {};
  return {
    roomCode: room.roomId || "",
    gameType: room.gameType || "",
    participants: players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      isOwner: Boolean(player.isHost),
      ready: Boolean(player.ready),
      connected: player.connected !== false,
    })),
    playerOrder: players
      .filter(player => player.id !== moderatorPlayerId)
      .map(player => player.id),
    currentPlayerId: viewer.playerId || "",
    ownerId: owner ? owner.id : "",
    moderatorAssignment,
    isGameModerator: Boolean(viewer.isGameModerator),
    canControlGame:
      moderatorAssignment.mode === "human"
        ? Boolean(viewer.isGameModerator)
        : Boolean(viewer.isHost),
    gameStarted: Boolean(room.gameStarted),
  };
}

function connectionStatusLine(view) {
  if (view.error) return view.error;
  switch (view.connectionStatus) {
    case "Connecting":
    case "Syncing":
      return "正在同步房间状态…";
    case "Reconnecting":
      return "正在恢复连接并重新同步…";
    case "Disconnected":
      return "连接已断开，回到前台后会自动恢复。";
    case "Failed":
      return "连接失败，请返回后重试。";
    default:
      return "等待 authoritative room projection。";
  }
}

function errorMessage(error) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "操作失败，请重试";
}

Page({
  data: {
    roomCode: "",
    gameLabel: "",
    moderatorLabel: "",
    moderatorName: "自动",
    seats: [],
    participants: [],
    playerOrder: [],
    currentPlayerId: "",
    currentPlayerReady: false,
    isOwner: false,
    isGameModerator: false,
    canControlGame: false,
    gameStarted: false,
    draggingPlayerId: "",
    draggingModerator: false,
    dragOverModerator: false,
    statusLine: "等待 authoritative room projection。",
  },

  onLoad(options) {
    const app = getApp();
    this._product = app.globalData.product;
    this.setData({
      gameLabel: this._product.gameLabel,
      moderatorLabel: this._product.moderatorLabel,
    });

    this.setData({
      roomCode: options && options.room ? String(options.room) : "",
    });

    this._client = app.getGameClient();
    this._detachClient = this._client.subscribe(view => {
      if (view.room) {
        this.applyLobbyModel(authoritativeLobbyModel(view.room));
        return;
      }
      this.setData({ statusLine: connectionStatusLine(view) });
    });

    if (this._client.getView().connectionStatus === "Idle") {
      this._client.startStoredSession();
    }
  },

  onReady() {
    this.refreshTableGeometry();
  },

  onResize() {
    this.refreshTableGeometry();
  },

  onUnload() {
    if (this._detachClient) {
      this._detachClient();
      this._detachClient = null;
    }
  },

  refreshTableGeometry() {
    const query = wx.createSelectorQuery().in(this);
    query.select(".table-stage").boundingClientRect();
    query.select(".table-center").boundingClientRect();
    query.exec(result => {
      this._tableRect = result && result[0] ? result[0] : null;
      this._moderatorRect = result && result[1] ? result[1] : null;
    });
  },

  applyLobbyModel(model) {
    const participants = Array.isArray(model.participants) ? model.participants : [];
    const participantMap = toParticipantMap(participants);
    const currentPlayer = participantMap[model.currentPlayerId];
    const moderatorAssignment = canonicalModeratorAssignment(model.moderatorAssignment);
    const humanModerator =
      moderatorAssignment.mode === "human"
        ? participantMap[moderatorAssignment.playerId]
        : null;

    this._lobbyModel = {
      ...model,
      participants,
      playerOrder: Array.isArray(model.playerOrder) ? model.playerOrder : [],
      moderatorAssignment,
    };

    this.setData({
      roomCode: model.roomCode || "",
      moderatorName: humanModerator ? humanModerator.name : "自动",
      seats: computeRoundedTableSeats(this._lobbyModel.playerOrder, participantMap),
      participants,
      playerOrder: this._lobbyModel.playerOrder,
      currentPlayerId: model.currentPlayerId || "",
      currentPlayerReady: Boolean(currentPlayer && currentPlayer.ready),
      isOwner: model.ownerId === model.currentPlayerId,
      isGameModerator: Boolean(model.isGameModerator),
      canControlGame: Boolean(model.canControlGame),
      gameStarted: Boolean(model.gameStarted),
      draggingPlayerId: "",
      draggingModerator: false,
      dragOverModerator: false,
      statusLine: model.gameStarted
        ? "服务器已开始游戏，authoritative PlayerView 已切换到游戏状态。"
        : "已连接 authoritative room projection。",
    });
  },

  renderPreviewOrder(playerOrder) {
    if (!this._lobbyModel) return;
    const participantMap = toParticipantMap(this._lobbyModel.participants);
    this.setData({
      playerOrder,
      seats: computeRoundedTableSeats(playerOrder, participantMap),
    });
  },

  ringIndexForPoint(point, playerCount) {
    const rect = this._tableRect;
    if (!rect || !point || !playerCount) return null;
    const xRpx = ((point.x - rect.left) / rect.width) * TABLE_WIDTH_RPX;
    const yRpx = ((point.y - rect.top) / rect.height) * TABLE_HEIGHT_RPX;
    return resolveRoundedTableRingIndex(xRpx, yRpx, playerCount);
  },

  onSeatLongPress(event) {
    if (!this.data.isOwner || this.data.gameStarted || !this._lobbyModel) return;
    const playerId = event.currentTarget.dataset.playerId;
    if (!playerId || !this._lobbyModel.playerOrder.includes(playerId)) return;
    this._dragState = {
      kind: "player",
      playerId,
      originalOrder: [...this._lobbyModel.playerOrder],
      previewOrder: [...this._lobbyModel.playerOrder],
      dragOverModerator: false,
    };
    this.setData({ draggingPlayerId: playerId });
  },

  onSeatTouchMove(event) {
    const drag = this._dragState;
    if (!drag || drag.kind !== "player") return;
    const point = eventPoint(event);
    if (!point) return;

    const overModerator = containsPoint(this._moderatorRect, point);
    drag.dragOverModerator = overModerator;
    if (overModerator) {
      this.setData({ dragOverModerator: true });
      return;
    }

    const targetIndex = this.ringIndexForPoint(point, drag.previewOrder.length);
    if (targetIndex === null) return;
    const nextOrder = movePlayerId(drag.previewOrder, drag.playerId, targetIndex);
    drag.previewOrder = nextOrder;
    this.setData({ dragOverModerator: false });
    this.renderPreviewOrder(nextOrder);
  },

  async onSeatTouchEnd() {
    const drag = this._dragState;
    if (!drag || drag.kind !== "player" || !this._lobbyModel) return;
    this._dragState = null;
    this.setData({
      draggingPlayerId: "",
      dragOverModerator: false,
    });

    try {
      if (drag.dragOverModerator) {
        await this._client.sendCommand("room.setGameModerator", {
          assignment: { mode: "human", playerId: drag.playerId },
        });
        return;
      }

      const finalIndex = drag.previewOrder.indexOf(drag.playerId);
      const originalIndex = drag.originalOrder.indexOf(drag.playerId);
      if (finalIndex < 0 || finalIndex === originalIndex) {
        this.applyLobbyModel(this._lobbyModel);
        return;
      }

      const nextVisibleId = drag.previewOrder[finalIndex + 1];
      const fullOrder = [...this._lobbyModel.participants]
        .sort((left, right) => left.seat - right.seat)
        .map(player => player.id);
      const insertIndex = nextVisibleId
        ? fullOrder.indexOf(nextVisibleId)
        : fullOrder.length;

      await this._client.sendCommand("room.movePlayerSeat", {
        targetPlayerId: drag.playerId,
        insertIndex,
      });
    } catch (error) {
      this.applyLobbyModel(this._lobbyModel);
      wx.showToast({ title: errorMessage(error), icon: "none" });
    }
  },

  onModeratorLongPress() {
    if (
      !this.data.isOwner ||
      this.data.gameStarted ||
      !this._lobbyModel ||
      this._lobbyModel.moderatorAssignment.mode !== "human"
    ) {
      return;
    }

    this._dragState = {
      kind: "moderator",
      playerId: this._lobbyModel.moderatorAssignment.playerId,
      targetIndex: null,
    };
    this.setData({ draggingModerator: true });
  },

  onModeratorTouchMove(event) {
    const drag = this._dragState;
    if (!drag || drag.kind !== "moderator") return;
    const point = eventPoint(event);
    if (!point || containsPoint(this._moderatorRect, point)) {
      drag.targetIndex = null;
      return;
    }
    drag.targetIndex = this.ringIndexForPoint(
      point,
      this._lobbyModel ? this._lobbyModel.playerOrder.length + 1 : 0
    );
  },

  async onModeratorTouchEnd() {
    const drag = this._dragState;
    if (!drag || drag.kind !== "moderator" || !this._lobbyModel) return;
    this._dragState = null;
    this.setData({ draggingModerator: false });
    if (drag.targetIndex === null) return;

    try {
      const visibleOrder = [...this._lobbyModel.playerOrder];
      const targetIndex = Math.max(0, Math.min(drag.targetIndex, visibleOrder.length));
      visibleOrder.splice(targetIndex, 0, drag.playerId);
      const nextVisibleId = visibleOrder[targetIndex + 1];
      const fullOrder = [...this._lobbyModel.participants]
        .sort((left, right) => left.seat - right.seat)
        .map(player => player.id);
      const insertIndex = nextVisibleId
        ? fullOrder.indexOf(nextVisibleId)
        : fullOrder.length;

      await this._client.sendCommand("room.movePlayerSeat", {
        targetPlayerId: drag.playerId,
        insertIndex,
      });
      await this._client.sendCommand("room.setGameModerator", {
        assignment: { mode: "automatic" },
      });
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: "none" });
    }
  },

  async onReadyTap() {
    if (!this._lobbyModel || this.data.isGameModerator || this.data.gameStarted) return;
    const nextReady = !this.data.currentPlayerReady;
    try {
      await this._client.sendCommand("room.setReady", { ready: nextReady });
      if (nextReady && !this._readyCapabilityTested) {
        this._readyCapabilityTested = true;
        if (wx.vibrateShort) {
          wx.vibrateShort({
            type: "heavy",
            fail() {},
          });
        }
      }
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: "none" });
    }
  },

  onSettingsTap() {
    wx.navigateTo({
      url: "/pages/settings",
    });
  },

  onInviteTap() {
    wx.showToast({
      title: `房间号：${this.data.roomCode}`,
      icon: "none",
    });
  },

  async onStartGameTap() {
    if (!this.data.canControlGame || this.data.gameStarted) return;

    if (!this._product.startCommand) {
      wx.showToast({
        title: `${this._product.gameLabel}设置将在下一阶段接入`,
        icon: "none",
      });
      return;
    }

    wx.showLoading({ title: "开始游戏…" });
    try {
      await this._client.sendCommand(this._product.startCommand, {});
      wx.showToast({ title: "游戏已开始", icon: "success" });
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },
});
