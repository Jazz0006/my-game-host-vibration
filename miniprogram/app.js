const {
  createWeChatNativeClientFromGlobal,
} = require("./runtime/client/WeChatNativeClient.js");

const WORKER_BASE_URL = "https://my-game-host-vibration.jazz-zeng.workers.dev";

App({
  globalData: {
    workerBaseUrl: WORKER_BASE_URL,
  },

  onLaunch() {
    this._gameClient = createWeChatNativeClientFromGlobal({
      baseUrl: WORKER_BASE_URL,
    });
  },

  getGameClient() {
    if (!this._gameClient) {
      this._gameClient = createWeChatNativeClientFromGlobal({
        baseUrl: WORKER_BASE_URL,
      });
    }
    return this._gameClient;
  },
});
