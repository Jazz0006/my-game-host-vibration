const {
  createPreviewLobby,
} = require("../lobby-preview-state.js");

Page({
  data: {
    activeTab: "room-management",
    previewMode: false,
    ownerId: "",
    participants: [],
  },

  onLoad(options) {
    const previewMode = options && options.preview === "1";
    if (!previewMode) {
      this.setData({ previewMode: false });
      return;
    }

    const lobby = createPreviewLobby("6284");
    this.setData({
      previewMode: true,
      ownerId: lobby.ownerId,
      participants: lobby.participants,
    });
  },

  onTransferOwnerTap(event) {
    if (!this.data.previewMode) return;
    const playerId = event.currentTarget.dataset.playerId;
    const participant = this.data.participants.find(item => item.id === playerId);
    wx.showToast({
      title: participant ? `预览：移交给 ${participant.name}` : "未找到玩家",
      icon: "none",
    });
  },

  onKickTap(event) {
    if (!this.data.previewMode) return;
    const playerId = event.currentTarget.dataset.playerId;
    const participant = this.data.participants.find(item => item.id === playerId);
    wx.showToast({
      title: participant ? `预览：移出 ${participant.name}` : "未找到玩家",
      icon: "none",
    });
  },
});
