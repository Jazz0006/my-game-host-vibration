const {
  createBotcGamePresentation,
} = require("../runtime/client/BotcGamePresentation.js");

function errorMessage(error) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "操作失败，请重试";
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
    canCommitNightInformation: false,
    canAcknowledgeNightInformation: false,
    canCompleteNightStep: false,
    isNightWake: false,
    isNightWaiting: false,
    nightStepId: "",
    nightChoiceOptions: [],
    nightChoiceMinTargets: 0,
    nightChoiceMaxTargets: 0,
    nightChoiceSelectedCount: 0,
    canSubmitNightChoice: false,
    redHerringOptions: [],
    redHerringSelectedPlayerId: "",
    canSetRedHerring: false,
    moderatorStepId: "",
    moderatorActorNames: "",
    minionDemonName: "",
    fellowMinionNames: "",
    demonMinionNames: "",
    demonBluffNames: "",
    privateInformationRoleName: "",
    privateInformationPlayerNames: "",
    privateInformationZeroLabel: "",
    privateInformationNumber: null,
    hasPrivateInformationNumber: false,
    privateInformationBooleanLabel: "",
    spyGrimoireRows: [],
    spyGrimoireReminderLines: [],
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

    const firstPresentation = createBotcGamePresentation({
      room: view.room || null,
      playerView: view.playerView || null,
      connectionStatus: view.connectionStatus,
      error: view.error,
      selectedNightChoiceIds: this._selectedNightChoiceIds || [],
      selectedRedHerringPlayerId: this._selectedRedHerringPlayerId || "",
    });
    if (firstPresentation.nightChoiceKey !== this._nightChoiceKey) {
      this._nightChoiceKey = firstPresentation.nightChoiceKey;
      this._selectedNightChoiceIds = [];
    }
    if (firstPresentation.redHerringKey !== this._redHerringKey) {
      this._redHerringKey = firstPresentation.redHerringKey;
      this._selectedRedHerringPlayerId = "";
    }

    const presentation = createBotcGamePresentation({
      room: view.room || null,
      playerView: view.playerView || null,
      connectionStatus: view.connectionStatus,
      error: view.error,
      selectedNightChoiceIds: this._selectedNightChoiceIds || [],
      selectedRedHerringPlayerId: this._selectedRedHerringPlayerId || "",
    });

    if (
      presentation.isNightWake &&
      presentation.nightStepId &&
      this._lastWakeStepId !== presentation.nightStepId
    ) {
      this._lastWakeStepId = presentation.nightStepId;
      if (wx.vibrateShort) {
        wx.vibrateShort({
          type: "heavy",
          fail() {},
        });
      }
    }
    if (!presentation.isNightWake) {
      this._lastWakeStepId = "";
    }

    this.setData({
      ...presentation,
      canConfirmRole: Boolean(
        this._product.confirmRoleCommand && presentation.canConfirmRole
      ),
      canSetRedHerring: Boolean(
        this._product.setRedHerringCommand && presentation.canSetRedHerring
      ),
      canBeginFirstNight: Boolean(
        this._product.beginFirstNightCommand && presentation.canBeginFirstNight
      ),
      canCommitNightInformation: Boolean(
        this._product.commitNightInformationCommand &&
        presentation.canCommitNightInformation
      ),
      canAcknowledgeNightInformation: Boolean(
        this._product.acknowledgeNightInformationCommand &&
        presentation.canAcknowledgeNightInformation
      ),
      canCompleteNightStep: Boolean(
        this._product.completeNightStepCommand &&
        presentation.canCompleteNightStep
      ),
      canSubmitNightChoice: Boolean(
        this._product.nightChoiceCommand && presentation.canSubmitNightChoice
      ),
    });
  },

  async sendProductCommand(command, payload, loadingTitle) {
    if (!command || this._commandInFlight) return;
    this._commandInFlight = true;
    wx.showLoading({ title: loadingTitle });
    try {
      await this._client.sendCommand(command, payload || {});
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
      {},
      "正在确认…"
    );
  },

  onRedHerringTap(event) {
    const playerId = event.currentTarget.dataset.playerId;
    const options = this.data.redHerringOptions || [];
    if (!playerId || !options.some(option => option.id === playerId)) return;
    this._selectedRedHerringPlayerId = playerId;
    this.setData({
      redHerringSelectedPlayerId: playerId,
      redHerringOptions: options.map(option => ({
        ...option,
        selected: option.id === playerId,
      })),
      canSetRedHerring: Boolean(this._product.setRedHerringCommand),
    });
  },

  onSetRedHerringTap() {
    if (!this.data.canSetRedHerring || !this._selectedRedHerringPlayerId) return;
    return this.sendProductCommand(
      this._product.setRedHerringCommand,
      { playerId: this._selectedRedHerringPlayerId },
      "设置红鲱鱼…"
    );
  },

  onBeginFirstNightTap() {
    if (!this.data.canBeginFirstNight) return;
    return this.sendProductCommand(
      this._product.beginFirstNightCommand,
      {},
      "进入首夜…"
    );
  },

  onCommitNightInformationTap() {
    if (!this.data.canCommitNightInformation) return;
    return this.sendProductCommand(
      this._product.commitNightInformationCommand,
      {},
      "生成信息…"
    );
  },

  onAcknowledgeNightInformationTap() {
    if (!this.data.canAcknowledgeNightInformation) return;
    return this.sendProductCommand(
      this._product.acknowledgeNightInformationCommand,
      {},
      "确认信息…"
    );
  },

  onCompleteNightStepTap() {
    if (!this.data.canCompleteNightStep) return;
    return this.sendProductCommand(
      this._product.completeNightStepCommand,
      {},
      "推进夜间…"
    );
  },

  onNightChoiceTap(event) {
    const playerId = event.currentTarget.dataset.playerId;
    if (!playerId) return;

    const options = this.data.nightChoiceOptions || [];
    if (!options.some(option => option.id === playerId)) return;

    const maxTargets = Number(this.data.nightChoiceMaxTargets) || 0;
    const selected = [...(this._selectedNightChoiceIds || [])];
    const existingIndex = selected.indexOf(playerId);
    if (existingIndex >= 0) {
      selected.splice(existingIndex, 1);
    } else if (maxTargets === 1) {
      selected.splice(0, selected.length, playerId);
    } else if (selected.length < maxTargets) {
      selected.push(playerId);
    }

    this._selectedNightChoiceIds = selected;
    const minTargets = Number(this.data.nightChoiceMinTargets) || 0;
    this.setData({
      nightChoiceOptions: options.map(option => ({
        ...option,
        selected: selected.includes(option.id),
      })),
      nightChoiceSelectedCount: selected.length,
      canSubmitNightChoice:
        selected.length >= minTargets && selected.length <= maxTargets,
    });
  },

  async onSubmitNightChoiceTap() {
    if (!this.data.canSubmitNightChoice) return;
    const selected = [...(this._selectedNightChoiceIds || [])];
    await this.sendProductCommand(
      this._product.nightChoiceCommand,
      { playerIds: selected },
      "提交选择…"
    );
  },
});

