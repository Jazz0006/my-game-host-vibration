const {
  computeRoundedTableSeats,
} = require("../rounded-table-layout.js");
const {
  PREVIEW_GAMES,
  createPreviewLobby,
} = require("../lobby-preview-state.js");

function toParticipantMap(participants) {
  const result = {};
  for (const participant of participants || []) {
    result[participant.id] = participant;
  }
  return result;
}

Page({
  data: {
    previewMode: false,
    roomCode: "",
    games: PREVIEW_GAMES,
    selectedGame: "werewolf",
    moderatorLabel: "法官",
    moderatorName: "自动",
    seats: [],
    participants: [],
    playerOrder: [],
    currentPlayerId: "",
    currentPlayerReady: false,
    isOwner: false,
    statusLine: "等待 authoritative room projection。",
  },

  onLoad(options) {
    const previewMode = options && options.preview === "1";
    if (!previewMode) {
      this.setData({
        previewMode: false,
        roomCode: options && options.room ? String(options.room) : "",
      });
      return;
    }

    const model = createPreviewLobby(options && options.room);
    this.applyLobbyModel(model, true);
  },

  applyLobbyModel(model, previewMode) {
    const participants = Array.isArray(model.participants) ? model.participants : [];
    const participantMap = toParticipantMap(participants);
    const selectedGame =
      PREVIEW_GAMES.find(game => game.id === model.selectedGame) || PREVIEW_GAMES[0];
    const currentPlayer = participantMap[model.currentPlayerId];
    const moderatorAssignment = model.moderatorAssignment || { type: "automatic" };
    const humanModerator =
      moderatorAssignment.type === "human"
        ? participantMap[moderatorAssignment.playerId]
        : null;

    this._lobbyModel = {
      ...model,
      participants,
      playerOrder: Array.isArray(model.playerOrder) ? model.playerOrder : [],
    };

    this.setData({
      previewMode: Boolean(previewMode),
      roomCode: model.roomCode || "",
      selectedGame: selectedGame.id,
      moderatorLabel: selectedGame.moderatorLabel,
      moderatorName: humanModerator ? humanModerator.name : "自动",
      seats: computeRoundedTableSeats(this._lobbyModel.playerOrder, participantMap),
      participants,
      playerOrder: this._lobbyModel.playerOrder,
      currentPlayerId: model.currentPlayerId || "",
      currentPlayerReady: Boolean(currentPlayer && currentPlayer.ready),
      isOwner: model.ownerId === model.currentPlayerId,
      statusLine: previewMode
        ? "UI Preview：当前使用本地展示数据，不是服务器 authoritative state。"
        : "已连接 authoritative room projection。",
    });
  },

  onGameTap(event) {
    if (!this.data.previewMode || !this.data.isOwner) return;
    const gameId = event.currentTarget.dataset.gameId;
    const game = PREVIEW_GAMES.find(item => item.id === gameId);
    if (!game || !this._lobbyModel) return;

    this._lobbyModel.selectedGame = game.id;
    this.setData({
      selectedGame: game.id,
      moderatorLabel: game.moderatorLabel,
    });
  },

  onReadyTap() {
    if (!this.data.previewMode || !this._lobbyModel) return;
    const currentPlayer = this._lobbyModel.participants.find(
      participant => participant.id === this._lobbyModel.currentPlayerId,
    );
    if (!currentPlayer) return;

    const nextReady = !currentPlayer.ready;
    currentPlayer.ready = nextReady;
    if (nextReady && wx.vibrateShort) {
      wx.vibrateShort({ type: "light" });
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
      title: this.data.previewMode ? "分享接线稍后补上" : "邀请入口待接线",
      icon: "none",
    });
  },

  onStartGameTap() {
    wx.showToast({
      title: "Setup 入口将在游戏模块接线后启用",
      icon: "none",
    });
  },
});
