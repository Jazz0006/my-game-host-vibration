const {
  createWeChatNativeClientFromGlobal,
  WECHAT_SESSION_CREDENTIAL_STORAGE_KEY,
} = require("../../runtime/client/WeChatNativeClient.js");
const {
  WeChatMinimalPageController,
} = require("../../runtime/client/WeChatMinimalPageController.js");

const BASE_URL_STORAGE_KEY = "gamehost.dev.workerBaseUrl.v1";

function emptyClientView() {
  return {
    screen: "resume-required",
    connectionStatus: "Idle",
    room: null,
    roomRevision: null,
    playerView: null,
    playerRevision: null,
  };
}

function normalizedBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function pretty(value) {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

Page({
  data: {
    baseUrl: "",
    roomId: "",
    playerId: "",
    resumeToken: "",
    commandType: "werewolf.startGame",
    commandPayload: "{}",
    client: emptyClientView(),
    roomJson: "",
    playerViewJson: "",
    lastAction: "Configure a Worker Base URL and existing room credentials.",
  },

  onLoad() {
    const baseUrl = normalizedBaseUrl(wx.getStorageSync(BASE_URL_STORAGE_KEY));
    this.setData({ baseUrl });
    if (baseUrl) this.mountClient(baseUrl, true);
  },

  onUnload() {
    this.unmountClient();
  },

  onBaseUrlInput(event) {
    this.setData({ baseUrl: event.detail.value });
  },

  onRoomIdInput(event) {
    this.setData({ roomId: event.detail.value });
  },

  onPlayerIdInput(event) {
    this.setData({ playerId: event.detail.value });
  },

  onResumeTokenInput(event) {
    this.setData({ resumeToken: event.detail.value });
  },

  onCommandTypeInput(event) {
    this.setData({ commandType: event.detail.value });
  },

  onCommandPayloadInput(event) {
    this.setData({ commandPayload: event.detail.value });
  },

  onConnectTap() {
    const baseUrl = normalizedBaseUrl(this.data.baseUrl);
    const roomId = String(this.data.roomId || "").trim();
    const playerId = String(this.data.playerId || "").trim();
    const resumeToken = String(this.data.resumeToken || "").trim();

    if (!/^https:\/\//i.test(baseUrl)) {
      this.setData({ lastAction: "Worker Base URL must use HTTPS for real-device validation." });
      return;
    }
    if (!roomId || !playerId || !resumeToken) {
      this.setData({ lastAction: "Room ID, Player ID and Resume Token are required." });
      return;
    }

    wx.setStorageSync(BASE_URL_STORAGE_KEY, baseUrl);
    this.unmountClient();

    try {
      const mounted = this.createClient(baseUrl);
      mounted.client.startSession({ roomId, playerId, resumeToken });
      mounted.controller.onLoad();
      this.setData({ lastAction: "Session started. Waiting for ticket / WebSocket / sync." });
    } catch (error) {
      this.setData({ lastAction: error && error.message ? error.message : String(error) });
    }
  },

  onClearSessionTap() {
    if (this._client) {
      this._client.clearStoredSession();
    } else {
      wx.removeStorageSync(WECHAT_SESSION_CREDENTIAL_STORAGE_KEY);
    }
    this.unmountClient();
    this.setData({
      client: emptyClientView(),
      roomJson: "",
      playerViewJson: "",
      roomId: "",
      playerId: "",
      resumeToken: "",
      lastAction: "Stored session credentials cleared.",
    });
  },

  onStartGameTap() {
    this.sendCommand("werewolf.startGame", {});
  },

  onSendSemanticCommandTap() {
    const type = String(this.data.commandType || "").trim();
    if (!type) {
      this.setData({ lastAction: "Semantic command type is required." });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(String(this.data.commandPayload || "{}"));
    } catch (error) {
      this.setData({
        lastAction: "Command payload must be valid JSON: " +
          (error && error.message ? error.message : String(error)),
      });
      return;
    }

    this.sendCommand(type, payload);
  },

  mountClient(baseUrl, resumeStoredSession) {
    this.unmountClient();
    const mounted = this.createClient(baseUrl);
    const resumed = resumeStoredSession ? mounted.controller.onLoad() : false;
    this.setData({
      lastAction: resumed
        ? "Stored credentials found. Waiting for reconnect / sync."
        : "No stored session credentials. Enter credentials below.",
    });
  },

  createClient(baseUrl) {
    const client = createWeChatNativeClientFromGlobal({ baseUrl });
    const pageBridge = {
      setData: ({ client: view }) => {
        this.setData({
          client: view,
          roomJson: pretty(view.room),
          playerViewJson: pretty(view.playerView),
        });
      },
    };
    const controller = new WeChatMinimalPageController(client, pageBridge);
    this._client = client;
    this._controller = controller;
    return { client, controller };
  },

  unmountClient() {
    if (this._controller) this._controller.onUnload();
    if (this._client) this._client.dispose();
    this._controller = null;
    this._client = null;
  },

  sendCommand(type, payload) {
    if (!this._controller) {
      this.setData({ lastAction: "No active native client session." });
      return;
    }

    this._controller.sendCommand(type, payload).then(
      result => {
        this.setData({ lastAction: "Command ACK: " + pretty(result) });
      },
      error => {
        this.setData({
          lastAction: "Command failed: " +
            (error && error.message ? error.message : String(error)),
        });
      },
    );
  },
});
