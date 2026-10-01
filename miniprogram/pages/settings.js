const {
  createClientLobbyPresentation,
} = require("../runtime/client/ClientLobbyPresentation.js");

function errorMessage(error) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "操作失败，请重试";
}

Page({
  data: {
    activeTab: "room-management",
    roomCode: "",
    currentPlayerId: "",
    isOwner: false,
    gameStarted: false,
    participants: [],
  },

  onLoad() {
    const app = getApp();
    this._client = app.getGameClient();
    this._detachClient = this._client.subscribe(view => {
      if (!view.room) return;
      const model = createClientLobbyPresentation(view.room);
      this.setData({
        roomCode: model.roomCode,
        currentPlayerId: model.currentPlayerId,
        isOwner: model.isOwner,
        gameStarted: model.gameStarted,
        participants: model.participants,
      });
    });
  },

  onUnload() {
    if (this._detachClient) {
      this._detachClient();
      this._detachClient = null;
    }
  },

  confirmAction(title, content, onConfirm) {
    wx.showModal({
      title,
      content,
      confirmColor: "#a33b32",
      success: result => {
        if (!result.confirm) return;
        void onConfirm();
      },
    });
  },

  onTransferOwnerTap(event) {
    if (!this.data.isOwner) return;
    const playerId = event.currentTarget.dataset.playerId;
    const participant = this.data.participants.find(item => item.id === playerId);
    if (!participant || participant.id === this.data.currentPlayerId) return;

    this.confirmAction(
      "移交房主",
      "确定把房主移交给 " + participant.name + "？说书人/法官 assignment 不会改变。",
      async () => {
        wx.showLoading({ title: "正在移交…" });
        try {
          await this._client.sendCommand("room.transferHost", {
            targetPlayerId: participant.id,
          });
          wx.showToast({ title: "房主已移交", icon: "success" });
        } catch (error) {
          wx.showToast({ title: errorMessage(error), icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    );
  },

  onKickTap(event) {
    if (!this.data.isOwner || this.data.gameStarted) return;
    const playerId = event.currentTarget.dataset.playerId;
    const participant = this.data.participants.find(item => item.id === playerId);
    if (!participant || participant.id === this.data.currentPlayerId) return;

    this.confirmAction(
      "移出玩家",
      "确定将 " + participant.name + " 移出房间？",
      async () => {
        wx.showLoading({ title: "正在移出…" });
        try {
          await this._client.sendCommand("room.removePlayer", {
            targetPlayerId: participant.id,
          });
          wx.showToast({ title: "玩家已移出", icon: "success" });
        } catch (error) {
          wx.showToast({ title: errorMessage(error), icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    );
  },
});
