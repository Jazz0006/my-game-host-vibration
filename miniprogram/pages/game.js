function errorMessage(error) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "操作失败，请重试";
}

function connectionStatusLine(view) {
  if (view.error) return view.error;
  switch (view.connectionStatus) {
    case "Connecting":
    case "Syncing":
      return "正在同步游戏状态…";
    case "Reconnecting":
      return "正在恢复连接并重新同步…";
    case "Disconnected":
      return "连接已断开，回到前台后会自动恢复。";
    case "Failed":
      return "连接失败，请返回后重试。";
    default:
      return "";
  }
}

function roleRevealStatus(playerView, allConfirmed) {
  if (!playerView || playerView.phase !== "role_reveal") {
    return "等待 authoritative PlayerView。";
  }
  if (playerView.mode === "spectator") {
    return allConfirmed
      ? "所有玩家已确认身份，可以进入下一阶段。"
      : "你是说书人；等待所有玩家确认自己的身份。";
  }
  if (playerView.roleConfirmed || playerView.mode === "waiting") {
    return allConfirmed
      ? "所有玩家已确认身份，等待进入首夜。"
      : "你已确认身份；请等待其他玩家。";
  }
  return "请记住自己的身份，然后点击确认。";
}

Page({
  data: {
    gameLabel: "",
    phaseLabel: "身份确认",
    connectionStatus: "",
    roleName: "",
    roleCategory: "",
    roleConfirmed: false,
    isSpectator: false,
    canConfirmRole: false,
    confirmedRoles: 0,
    playerCount: 0,
    allConfirmed: false,
    statusLine: "等待 authoritative PlayerView。",
  },

  onLoad() {
    const app = getApp();
    this._product = app.globalData.product;
    this._client = app.getGameClient();
    this.setData({
      gameLabel: this._product.gameLabel || "",
    });

    this._detachClient = this._client.subscribe(view => {
      this.applyAuthoritativeView(view);
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

  applyAuthoritativeView(view) {
    if (view.room && !view.room.gameStarted) {
      if (!this._returningToLobby) {
        this._returningToLobby = true;
        wx.redirectTo({
          url: "/pages/lobby",
          fail: () => {
            this._returningToLobby = false;
          },
        });
      }
      return;
    }

    const playerView =
      view.playerView && typeof view.playerView === "object"
        ? view.playerView
        : null;
    const game =
      view.room &&
      view.room.game &&
      typeof view.room.game === "object"
        ? view.room.game
        : null;
    const confirmedRoles =
      game && Number.isFinite(Number(game.confirmedRoles))
        ? Number(game.confirmedRoles)
        : 0;
    const playerCount =
      game && Number.isFinite(Number(game.playerCount))
        ? Number(game.playerCount)
        : 0;
    const allConfirmed =
      playerCount > 0 && confirmedRoles >= playerCount;
    const isSpectator = Boolean(
      playerView && playerView.mode === "spectator"
    );
    const roleConfirmed = Boolean(
      playerView && playerView.roleConfirmed
    );
    const canConfirmRole = Boolean(
      this._product.confirmRoleCommand &&
      playerView &&
      playerView.phase === "role_reveal" &&
      playerView.mode === "role_reveal" &&
      !roleConfirmed
    );
    const connectionLine = connectionStatusLine(view);

    this.setData({
      connectionStatus: view.connectionStatus || "",
      roleName: playerView
        ? playerView.roleNameZh || playerView.roleName || ""
        : "",
      roleCategory: playerView ? playerView.roleCategory || "" : "",
      roleConfirmed,
      isSpectator,
      canConfirmRole,
      confirmedRoles,
      playerCount,
      allConfirmed,
      statusLine:
        connectionLine || roleRevealStatus(playerView, allConfirmed),
    });
  },

  async onConfirmRoleTap() {
    if (!this.data.canConfirmRole || this._confirming) return;
    this._confirming = true;
    wx.showLoading({ title: "正在确认…" });
    try {
      await this._client.sendCommand(
        this._product.confirmRoleCommand,
        {}
      );
    } catch (error) {
      wx.showToast({
        title: errorMessage(error),
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this._confirming = false;
    }
  },
});
