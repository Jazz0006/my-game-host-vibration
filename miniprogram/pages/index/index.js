Page({
  data: {
    roomCode: "",
    hasRecoverableRoom: false,
  },

  onRoomCodeInput(event) {
    const roomCode = String(event.detail.value || "")
      .replace(/\D/g, "")
      .slice(0, 4);
    this.setData({ roomCode });
  },

  onCreateRoomTap() {
    wx.showToast({
      title: "创建房间将在 authority 接线后启用",
      icon: "none",
    });
  },

  onJoinRoomTap() {
    if (!/^\d{4}$/.test(this.data.roomCode)) {
      wx.showToast({
        title: "请输入 4 位房间号",
        icon: "none",
      });
      return;
    }

    wx.showToast({
      title: "加入房间将在 authority 接线后启用",
      icon: "none",
    });
  },

  onContinueRoomTap() {
    wx.showToast({
      title: "恢复入口将在 session 接线后启用",
      icon: "none",
    });
  },

  onPreviewLobbyTap() {
    const room = /^\d{4}$/.test(this.data.roomCode) ? this.data.roomCode : "6284";
    wx.navigateTo({
      url: `/pages/lobby?preview=1&room=${room}`,
    });
  },

  onOpenDiagnosticsTap() {
    wx.navigateTo({
      url: "/pages/diagnostics",
    });
  },
});
