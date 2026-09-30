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
      const players = Array.isArray(view.room.players)
        ? [...view.room.players].sort((left, right) => left.seat - right.seat)
        : [];
      this.setData({
        roomCode: view.room.roomId || "",
        currentPlayerId: view.room.viewer ? view.room.viewer.playerId : "",
        isOwner: Boolean(view.room.viewer && view.room.viewer.isHost),
        gameStarted: Boolean(view.room.gameStarted),
        participants: players.map(player => ({
          id: player.id,
          name: player.name,
          seat: player.seat,
          isOwner: Boolean(player.isHost),
          connected: player.connected !== false,
          ready: Boolean(player.ready),
        })),
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
