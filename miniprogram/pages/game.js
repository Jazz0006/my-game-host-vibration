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

function playerName(room, playerId) {
  if (!room || !Array.isArray(room.players)) return playerId || "";
  const player = room.players.find(item => item.id === playerId);
  return player ? player.name : playerId || "";
}

function canControlGame(room) {
  if (!room || !room.viewer) return false;
  const assignment = room.gameModerator || { mode: "automatic" };
  return assignment.mode === "human"
    ? Boolean(room.viewer.isGameModerator)
    : Boolean(room.viewer.isHost);
}

function phaseLabel(phase) {
  switch (phase) {
    case "role_reveal":
      return "身份确认";
    case "first_night":
      return "首夜";
    case "other_night":
      return "夜晚";
    case "day":
      return "白天";
    default:
      return "游戏";
  }
}

function statusForView(playerView, allConfirmed, controller) {
  if (!playerView) return "等待 authoritative PlayerView。";

  if (playerView.phase === "role_reveal") {
    if (playerView.mode === "spectator") {
      return allConfirmed
        ? "所有玩家已确认身份，可以开始首夜。"
        : "你是说书人；等待所有玩家确认自己的身份。";
    }
    if (playerView.roleConfirmed || playerView.mode === "waiting") {
      return allConfirmed
        ? "所有玩家已确认身份，等待进入首夜。"
        : "你已确认身份；请等待其他玩家。";
    }
    return "请记住自己的身份，然后点击确认。";
  }

  if (playerView.phase === "first_night" || playerView.phase === "other_night") {
    if (playerView.mode === "night_wake") {
      return "请睁眼，查看当前夜间信息或按说书人指示行动。";
    }
    if (playerView.mode === "spectator") {
      return controller
        ? "请主持当前夜间步骤；确认处理完成后推进下一步。"
        : "夜间进行中。";
    }
    return controller
      ? "夜间进行中；处理当前步骤后推进。"
      : "请闭眼等待，被唤醒时手机会提示。";
  }

  if (playerView.phase === "day") {
    return "天亮了。白天流程将在下一阶段接入。";
  }

  return "等待 authoritative PlayerView。";
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
    canBeginFirstNight: false,
    canCompleteNightStep: false,
    isNightWake: false,
    isNightWaiting: false,
    nightStepId: "",
    moderatorStepId: "",
    moderatorActorNames: "",
    minionDemonName: "",
    fellowMinionNames: "",
    demonMinionNames: "",
    demonBluffNames: "",
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

    const room = view.room || null;
    const playerView =
      view.playerView && typeof view.playerView === "object"
        ? view.playerView
        : null;
    const game =
      room && room.game && typeof room.game === "object"
        ? room.game
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
    const controller = canControlGame(room);
    const phase = playerView
      ? playerView.phase || (game ? game.phase : "")
      : game
        ? game.phase || ""
        : "";
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
    const canBeginFirstNight = Boolean(
      this._product.beginFirstNightCommand &&
      controller &&
      phase === "role_reveal" &&
      allConfirmed
    );
    const canCompleteNightStep = Boolean(
      this._product.completeNightStepCommand &&
      controller &&
      (phase === "first_night" || phase === "other_night")
    );
    const nightStep =
      playerView && playerView.nightStep && typeof playerView.nightStep === "object"
        ? playerView.nightStep
        : null;
    const moderatorStep =
      game && game.nightStep && typeof game.nightStep === "object"
        ? game.nightStep
        : null;
    const minionInfo =
      playerView && playerView.minionInfo && typeof playerView.minionInfo === "object"
        ? playerView.minionInfo
        : null;
    const demonInfo =
      playerView && playerView.demonInfo && typeof playerView.demonInfo === "object"
        ? playerView.demonInfo
        : null;
    const isNightWake = Boolean(
      playerView && playerView.mode === "night_wake"
    );
    const isNightWaiting = Boolean(
      playerView &&
      (playerView.phase === "first_night" || playerView.phase === "other_night") &&
      playerView.mode === "waiting"
    );

    if (
      isNightWake &&
      nightStep &&
      nightStep.id &&
      this._lastWakeStepId !== nightStep.id
    ) {
      this._lastWakeStepId = nightStep.id;
      if (wx.vibrateShort) {
        wx.vibrateShort({
          type: "heavy",
          fail() {},
        });
      }
    }
    if (!isNightWake) {
      this._lastWakeStepId = "";
    }

    const connectionLine = connectionStatusLine(view);
    this.setData({
      connectionStatus: view.connectionStatus || "",
      phaseLabel: phaseLabel(phase),
      roleName: playerView
        ? playerView.roleNameZh || playerView.roleName || ""
        : "",
      roleCategory: playerView ? playerView.roleCategory || "" : "",
      roleConfirmed,
      isSpectator,
      canConfirmRole,
      canBeginFirstNight,
      canCompleteNightStep,
      isNightWake,
      isNightWaiting,
      nightStepId: nightStep ? nightStep.id || "" : "",
      moderatorStepId: moderatorStep ? moderatorStep.id || "" : "",
      moderatorActorNames:
        moderatorStep && Array.isArray(moderatorStep.actorPlayerIds)
          ? moderatorStep.actorPlayerIds
              .map(playerId => playerName(room, playerId))
              .join("、")
          : "",
      minionDemonName: minionInfo
        ? playerName(room, minionInfo.demonPlayerId)
        : "",
      fellowMinionNames:
        minionInfo && Array.isArray(minionInfo.fellowMinionPlayerIds)
          ? minionInfo.fellowMinionPlayerIds
              .map(playerId => playerName(room, playerId))
              .join("、")
          : "",
      demonMinionNames:
        demonInfo && Array.isArray(demonInfo.minionPlayerIds)
          ? demonInfo.minionPlayerIds
              .map(playerId => playerName(room, playerId))
              .join("、")
          : "",
      demonBluffNames:
        demonInfo && Array.isArray(demonInfo.bluffRoles)
          ? demonInfo.bluffRoles
              .map(role => role.nameZh || role.name || role.id)
              .join("、")
          : "",
      confirmedRoles,
      playerCount,
      allConfirmed,
      statusLine:
        connectionLine || statusForView(playerView, allConfirmed, controller),
    });
  },

  async sendProductCommand(command, loadingTitle) {
    if (!command || this._commandInFlight) return;
    this._commandInFlight = true;
    wx.showLoading({ title: loadingTitle });
    try {
      await this._client.sendCommand(command, {});
    } catch (error) {
      wx.showToast({
        title: errorMessage(error),
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this._commandInFlight = false;
    }
  },

  onConfirmRoleTap() {
    if (!this.data.canConfirmRole) return;
    return this.sendProductCommand(
      this._product.confirmRoleCommand,
      "正在确认…"
    );
  },

  onBeginFirstNightTap() {
    if (!this.data.canBeginFirstNight) return;
    return this.sendProductCommand(
      this._product.beginFirstNightCommand,
      "进入首夜…"
    );
  },

  onCompleteNightStepTap() {
    if (!this.data.canCompleteNightStep) return;
    return this.sendProductCommand(
      this._product.completeNightStepCommand,
      "推进夜间…"
    );
  },
});

