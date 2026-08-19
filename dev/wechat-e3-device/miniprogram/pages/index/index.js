import {
  createWeChatMiniProgramBindings,
} from "../../client-runtime/client/wechat/WeChatMiniProgramBindings.js";
import {
  createWeChatWerewolfVerticalSlice,
} from "../../client-runtime/client/wechat/WeChatWerewolfVerticalSlice.js";
import {
  attachWeChatSessionLifecycle,
} from "../../client-runtime/client/wechat/WeChatSessionLifecycle.js";

const STORAGE_KEY = "e3-wechat-device-credentials";
const BASE_URL = "https://my-game-host-vibration.jazz-zeng.workers.dev";
const MAX_LOG_LINES = 40;

function errorText(error) {
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function nowText() {
  const now = new Date();
  return now.toLocaleTimeString();
}

Page({
  data: {
    baseUrl: BASE_URL,
    roomId: "1234",
    playerId: "p1",
    resumeToken: "",
    started: false,
    connectionStatus: "Idle",
    generation: 0,
    revision: null,
    screen: "connecting",
    failureCode: "",
    failureMessage: "",
    roleName: "",
    actionId: "",
    targets: [],
    checkedPlayer: null,
    checkedAlignment: "",
    networkStatus: "unknown",
    logLines: [],
  },

  onLoad() {
    const saved = wx.getStorageSync(STORAGE_KEY);
    if (saved && typeof saved === "object") {
      this.setData({
        roomId: typeof saved.roomId === "string" ? saved.roomId : this.data.roomId,
        playerId: typeof saved.playerId === "string" ? saved.playerId : this.data.playerId,
        resumeToken: typeof saved.resumeToken === "string" ? saved.resumeToken : "",
      });
    }
    this.appendLog(`Harness loaded: ${BASE_URL}`);
  },

  onUnload() {
    this.cleanupSession();
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: event.detail.value });
  },

  appendLog(message) {
    const next = [...this.data.logLines, `${nowText()}  ${message}`];
    this.setData({ logLines: next.slice(-MAX_LOG_LINES) });
  },

  cleanupSession() {
    try { this._unsubscribe?.(); } catch {}
    try { this._detachLifecycle?.(); } catch {}
    try {
      if (this._bindings && this._foregroundObserver) {
        this._bindings.lifecycle.offAppShow?.(this._foregroundObserver);
      }
    } catch {}
    try {
      if (this._bindings && this._networkObserver) {
        this._bindings.lifecycle.offNetworkStatusChange?.(this._networkObserver);
      }
    } catch {}
    try { this._slice?.dispose(); } catch {}

    this._unsubscribe = null;
    this._detachLifecycle = null;
    this._foregroundObserver = null;
    this._networkObserver = null;
    this._slice = null;
    this._bindings = null;
  },

  startSession() {
    const roomId = this.data.roomId.trim();
    const playerId = this.data.playerId.trim();
    const resumeToken = this.data.resumeToken.trim();
    if (!/^\d{4}$/.test(roomId)) {
      this.appendLog("Start rejected: roomId must be 4 digits");
      return;
    }
    if (!playerId || !resumeToken) {
      this.appendLog("Start rejected: playerId and resumeToken are required");
      return;
    }

    this.cleanupSession();
    let commandSequence = 0;

    try {
      const bindings = createWeChatMiniProgramBindings(wx);
      const platform = Object.assign({}, bindings.realtime, bindings.effects);
      const slice = createWeChatWerewolfVerticalSlice(
        platform,
        { roomId, playerId, resumeToken },
        {
          transport: { baseUrl: BASE_URL },
          nextCommandId() {
            commandSequence += 1;
            return `wechat-device-${Date.now()}-${commandSequence}`;
          },
        },
      );

      this._bindings = bindings;
      this._slice = slice;

      this._detachLifecycle = attachWeChatSessionLifecycle(slice, bindings.lifecycle);

      this._foregroundObserver = () => {
        this.appendLog("wx app-show / foreground signal");
      };
      bindings.lifecycle.onAppShow(this._foregroundObserver);

      this._networkObserver = status => {
        const label = `${status.isConnected ? "online" : "offline"}${status.networkType ? ` (${status.networkType})` : ""}`;
        this.setData({ networkStatus: label });
        this.appendLog(`network status: ${label}`);
      };
      bindings.lifecycle.onNetworkStatusChange(this._networkObserver);

      this._unsubscribe = slice.subscribe(viewModel => {
        const connection = slice.getConnectionState();
        const failureCode = connection.failure?.code || "";
        const failureMessage = connection.failure?.message || "";
        this.setData({
          started: connection.status !== "Idle" && connection.status !== "Disposed",
          connectionStatus: connection.status,
          generation: connection.generation,
          revision: viewModel.revision,
          screen: viewModel.screen,
          failureCode,
          failureMessage,
          roleName: viewModel.roleName || "",
          actionId: viewModel.actionId || "",
          targets: viewModel.targets || [],
          checkedPlayer: viewModel.checkedPlayer || null,
          checkedAlignment: viewModel.checkedAlignment || "",
        });
        this.appendLog(
          `state ${connection.status} gen=${connection.generation} rev=${viewModel.revision ?? "-"} screen=${viewModel.screen}` +
            (failureCode ? ` failure=${failureCode}${failureMessage ? `: ${failureMessage}` : ""}` : ""),
        );
      });

      wx.setStorageSync(STORAGE_KEY, { roomId, playerId, resumeToken });
      this.appendLog(`Starting room=${roomId} player=${playerId}`);
      slice.start();
    } catch (error) {
      this.appendLog(`Start failed: ${errorText(error)}`);
      this.cleanupSession();
      this.setData({
        started: false,
        connectionStatus: "Idle",
        failureCode: "start-exception",
        failureMessage: errorText(error),
      });
    }
  },

  manualResync() {
    if (!this._slice) return;
    this.appendLog("Manual resync requested");
    this._slice.resync();
  },

  manualReconnect() {
    if (!this._slice) return;
    this.appendLog("Manual reconnect requested");
    this._slice.reconnect();
  },

  testShortVibration() {
    try {
      const bindings = this._bindings || createWeChatMiniProgramBindings(wx);
      if (!bindings.effects.vibrateShort) {
        this.appendLog("vibrateShort capability unavailable");
        return;
      }
      bindings.effects.vibrateShort({ type: "medium" });
      this.appendLog("Requested medium short vibration");
    } catch (error) {
      this.appendLog(`Short vibration failed: ${errorText(error)}`);
    }
  },

  testLongVibration() {
    try {
      const bindings = this._bindings || createWeChatMiniProgramBindings(wx);
      if (!bindings.effects.vibrateLong) {
        this.appendLog("vibrateLong capability unavailable");
        return;
      }
      bindings.effects.vibrateLong();
      this.appendLog("Requested long vibration");
    } catch (error) {
      this.appendLog(`Long vibration failed: ${errorText(error)}`);
    }
  },

  async submitTarget(event) {
    if (!this._slice) return;
    const targetPlayerId = event.currentTarget.dataset.id;
    try {
      this.appendLog(`Submitting seer target ${targetPlayerId}`);
      const ack = await this._slice.submitSeerTarget(targetPlayerId);
      this.appendLog(`Command ACK: ${JSON.stringify(ack)}`);
    } catch (error) {
      this.appendLog(`Command failed: ${errorText(error)}`);
    }
  },

  clearLog() {
    this.setData({ logLines: [] });
  },
});
