const {
  computeRoundedTableSeats,
} = require("../rounded-table-layout.js");
const {
  createPreviewLobby,
} = require("../lobby-preview-state.js");

function toParticipantMap(participants) {
  const result = {};
  for (const participant of participants || []) {
    result[participant.id] = participant;
  }
  return result;
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
      isOwner: Boolean(player.isHost),
      ready: false,
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
    previewMode: false,
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
    statusLine: "等待 authoritative room projection。",
  },

  onLoad(options) {
    const app = getApp();
    this._product = app.globalData.product;
    this.setData({
      gameLabel: this._product.gameLabel,
      moderatorLabel: this._product.moderatorLabel,
    });

    const previewMode = options && options.preview === "1";
    if (previewMode) {
      const model = createPreviewLobby(
        options && options.room,
        this._product.gameType,
      );
      this.applyLobbyModel(model, true);
      return;
    }

    this.setData({
      previewMode: false,
      roomCode: options && options.room ? String(options.room) : "",
    });

    this._client = app.getGameClient();
    this._detachClient = this._client.subscribe(view => {
      if (view.room) {
        this.applyLobbyModel(authoritativeLobbyModel(view.room), false);
        return;
      }
      this.setData({ statusLine: connectionStatusLine(view) });
    });

    if (this._client.getView().connectionStatus === "Idle") {
      this._client.startStoredSession();
    }
  },

  onUnload() {
    if (this._detachClient) {
      this._detachClient();
      this._detachClient = null;
    }
  },

  applyLobbyModel(model, previewMode) {
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
      previewMode: Boolean(previewMode),
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
      statusLine: previewMode
        ? "UI Preview：当前使用本地展示数据，不是服务器 authoritative state。"
        : model.gameStarted
          ? "服务器已开始游戏，authoritative PlayerView 已切换到游戏状态。"
          : "已连接 authoritative room projection。",
    });
  },

  onReadyTap() {
    if (!this._lobbyModel || this.data.isGameModerator) return;
    if (!this.data.previewMode) {
      wx.showToast({
        title: "准备状态将在 lobby command slice 接入",
        icon: "none",
      });
      return;
    }

    const currentPlayer = this._lobbyModel.participants.find(
      participant => participant.id === this._lobbyModel.currentPlayerId,
    );
    if (!currentPlayer) return;

    const nextReady = !currentPlayer.ready;
    currentPlayer.ready = nextReady;
    if (nextReady && wx.vibrateShort) {
      wx.vibrateShort({ type: "heavy" });
    }
    this.applyLobbyModel(this._lobbyModel, true);
  },

  onSettingsTap() {
    wx.navigateTo({
      url: `/pages/settings?preview=${this.data.previewMode ? "1" : "0"}`,
    });
  },

  onInviteTap() {
    wx.showToast({
      title: this.data.previewMode ? "分享接线稍后补上" : `房间号：${this.data.roomCode}`,
      icon: "none",
    });
  },

  async onStartGameTap() {
    if (!this.data.canControlGame || this.data.gameStarted) return;

    if (this.data.previewMode) {
      wx.showToast({
        title: "UI Preview 不会启动服务器游戏",
        icon: "none",
      });
      return;
    }

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
