const {
  createWeChatNativeClientFromGlobal,
} = require("./runtime/client/WeChatNativeClient.js");
const PRODUCT = require("./product-config.js");

const WORKER_BASE_URL = "https://my-game-host-vibration.jazz-zeng.workers.dev";

App({
  globalData: {
    workerBaseUrl: WORKER_BASE_URL,
    product: PRODUCT,
  },

  onLaunch() {
    this._gameClient = createWeChatNativeClientFromGlobal({
      baseUrl: WORKER_BASE_URL,
      gameType: PRODUCT.gameType,
    });
  },

  getGameClient() {
    if (!this._gameClient) {
      this._gameClient = createWeChatNativeClientFromGlobal({
        baseUrl: WORKER_BASE_URL,
        gameType: PRODUCT.gameType,
      });
    }
    return this._gameClient;
  },
});
