import fs from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string): string {
  return fs.readFileSync(path, "utf8");
}

describe("MG0D WeChat product runtime wiring", () => {
  it("binds native client gameType only through generated product config", () => {
    const app = text("miniprogram/app.js");
    expect(app).toContain('require("./product-config.js")');
    expect(app).toContain("gameType: PRODUCT.gameType");
    expect(app).toContain("createWeChatNativeClientFromGlobal");
    expect(app).toContain("https://my-game-host-vibration.jazz-zeng.workers.dev");
    expect(app).not.toContain('gameType: "werewolf"');
    expect(app).not.toContain('gameType: "botc"');

    const werewolf = text("wechat-build/werewolf/miniprogram/product-config.js");
    const botc = text("wechat-build/botc/miniprogram/product-config.js");
    expect(werewolf).toContain('"gameType": "werewolf"');
    expect(werewolf).toContain('"startCommand": "werewolf.startGame"');
    expect(botc).toContain('"gameType": "botc"');
    expect(botc).toContain('"startCommand": "botc.startGame"');
    expect(botc).toContain('"confirmRoleCommand": "botc.confirmRole"');
    expect(botc).toContain('"gamePage": "/pages/game"');
    expect(botc).not.toContain("werewolf.startGame");
  });

  it("uses real create/join/resume intents from the shared product entry page", () => {
    const entry = text("miniprogram/pages/index/index.js");
    const markup = text("miniprogram/pages/index/index.wxml");
    expect(entry).toContain("getGameClient");
    expect(entry).toContain(".createRoom(");
    expect(entry).toContain(".joinRoom(");
    expect(entry).toContain(".startStoredSession(");
    expect(entry).toContain("app.globalData.product.appName");
    expect(markup).toContain("{{productName}}");
  });

  it("renders one fixed game identity per product without a lobby game selector", () => {
    const lobby = text("miniprogram/pages/lobby.js");
    const markup = text("miniprogram/pages/lobby.wxml");
    expect(lobby).toContain("this._product.gameLabel");
    expect(lobby).toContain("this._product.moderatorLabel");
    expect(lobby).toContain("this._product.startCommand");
    expect(lobby).toContain("this._product.gamePage");
    expect(lobby).toContain(".subscribe(");
    expect(lobby).toContain("view.room");
    expect(lobby).not.toContain("selectedGame");
    expect(lobby).not.toContain("PREVIEW_GAMES");
    expect(lobby).not.toContain("werewolf.startGame");
    expect(markup).toContain("{{gameLabel}}");
    expect(markup).not.toContain("data-game-id");
    expect(markup).not.toContain("bindtap=\"onGameTap\"");

    const game = text("miniprogram/pages/game.js");
    expect(game).toContain("this._product.confirmRoleCommand");
    expect(game).toContain("view.playerView");
    expect(game).toContain("view.room");
  });
});
