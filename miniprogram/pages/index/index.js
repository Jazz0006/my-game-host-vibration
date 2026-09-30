function gameClient() {
  const app = getApp();
  return app.getGameClient();
}

function errorMessage(error) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "操作失败，请重试";
}

Page({
  data: {
    productName: "",
    roomCode: "",
    hasRecoverableRoom: false,
  },

  onShow() {
    const app = getApp();
    this.setData({
      productName: app.globalData.product.appName,
      hasRecoverableRoom: gameClient().hasStoredSession(),
    });
  },

  onRoomCodeInput(event) {
    const roomCode = String(event.detail.value || "")
      .replace(/\D/g, "")
      .slice(0, 4);
    this.setData({ roomCode });
  },

  async onCreateRoomTap() {
    if (this._busy) return;
    this._busy = true;
    let failure = "";
    wx.showLoading({ title: "创建房间…" });
    try {
      const session = await gameClient().createRoom();
      wx.navigateTo({
        url: `/pages/lobby?room=${session.roomId}`,
      });
    } catch (error) {
      failure = errorMessage(error);
      console.error("[wechat] create room failed", error);
    } finally {
      wx.hideLoading();
      this._busy = false;
      this.setData({ hasRecoverableRoom: gameClient().hasStoredSession() });
    }
    if (failure) {
      wx.showToast({ title: failure, icon: "none", duration: 4000 });
    }
  },

  async onJoinRoomTap() {
    if (!/^\d{4}$/.test(this.data.roomCode)) {
      wx.showToast({
        title: "请输入 4 位房间号",
        icon: "none",
      });
      return;
    }
    if (this._busy) return;

    this._busy = true;
    let failure = "";
    wx.showLoading({ title: "加入房间…" });
    try {
      const session = await gameClient().joinRoom(this.data.roomCode);
      wx.navigateTo({
        url: `/pages/lobby?room=${session.roomId}`,
      });
    } catch (error) {
      failure = errorMessage(error);
      console.error("[wechat] join room failed", error);
    } finally {
      wx.hideLoading();
      this._busy = false;
      this.setData({ hasRecoverableRoom: gameClient().hasStoredSession() });
    }
    if (failure) {
      wx.showToast({ title: failure, icon: "none", duration: 4000 });
    }
  },

  onContinueRoomTap() {
    const client = gameClient();
    const view = client.getView();
    const started =
      view.connectionStatus === "Idle"
        ? client.startStoredSession()
        : true;

    if (!started) {
      this.setData({ hasRecoverableRoom: false });
      wx.showToast({ title: "没有可恢复的房间", icon: "none" });
      return;
    }

    wx.navigateTo({
      url: "/pages/lobby",
    });
  },

  onOpenDiagnosticsTap() {
    wx.navigateTo({
      url: "/pages/diagnostics",
    });
  },
});
