import fs from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(text(path)) as Record<string, unknown>;
}

const PRODUCTS = [
  {
    id: "werewolf",
    gameType: "werewolf",
    appName: "骏骏桌游-狼人",
  },
  {
    id: "botc",
    gameType: "botc",
    appName: "骏骏桌游-血染",
  },
] as const;

describe("MG0D WeChat game-specific product shells", () => {
  it("generates two independent Developer Tools projects from one shared shell source", () => {
    for (const product of PRODUCTS) {
      const root = `wechat-build/${product.id}`;
      const config = json(`${root}/project.config.json`);
      expect(config.miniprogramRoot).toBe("miniprogram/");
      expect(config.compileType).toBe("miniprogram");
      expect(config.appid).toBe("touristappid");
      expect(config.setting).toMatchObject({
        urlCheck: true,
        es6: true,
      });

      const app = json(`${root}/miniprogram/app.json`);
      expect(app.pages).toEqual([
        "pages/index/index",
        "pages/lobby",
        "pages/settings",
        "pages/diagnostics",
      ]);
      expect(app.window).toMatchObject({
        navigationBarTitleText: product.appName,
      });

      const productConfig = text(`${root}/miniprogram/product-config.js`);
      expect(productConfig).toContain(`"gameType": "${product.gameType}"`);
      expect(productConfig).toContain(`"appName": "${product.appName}"`);
    }
  });

  it("builds one TypeScript client implementation into both generated product packages", () => {
    const config = json("tsconfig.wechat.json");
    expect(config.extends).toBe("./tsconfig.json");
    expect(config.compilerOptions).toMatchObject({
      module: "ESNext",
      moduleResolution: "Bundler",
      rootDir: "./src",
      noEmit: true,
    });
    expect(config.include).toEqual([
      "src/client/WeChatNativeClient.ts",
      "src/client/WeChatMinimalPageController.ts",
    ]);

    const pkg = json("package.json");
    expect(pkg.scripts).toMatchObject({
      "build:wechat": "node scripts/prepare-wechat-shell.mjs && tsc -p tsconfig.wechat.json && node scripts/build-wechat-runtime.mjs && node scripts/verify-wechat-shell.mjs",
    });

    for (const product of PRODUCTS) {
      expect(
        fs.existsSync(
          `wechat-build/${product.id}/miniprogram/runtime/client/WeChatNativeClient.js`,
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          `wechat-build/${product.id}/miniprogram/runtime/client/WeChatMinimalPageController.js`,
        ),
      ).toBe(true);
    }

    const ignore = text(".gitignore");
    expect(ignore).toContain("wechat-build/");
    expect(ignore).toContain("project.private.config.json");
  });

  it("keeps diagnostics and product UI as thin projections over shared runtime", () => {
    const diagnostics = text("miniprogram/pages/diagnostics.js");
    expect(diagnostics).toContain('require("../runtime/client/WeChatNativeClient.js")');
    expect(diagnostics).toContain('require("../runtime/client/WeChatMinimalPageController.js")');
    expect(diagnostics).not.toContain("/domain/");
    expect(diagnostics).not.toContain("/games/");
    expect(diagnostics).not.toContain("ClientRawWebSocketProtocol");
    expect(diagnostics).not.toContain("SocketTask");
    expect(diagnostics).not.toContain("room:state");

    const lobby = text("miniprogram/pages/lobby.js");
    const lobbyMarkup = text("miniprogram/pages/lobby.wxml");
    expect(lobby).toContain('require("../rounded-table-layout.js")');
    expect(lobby).toContain("applyLobbyModel");
    expect(lobby).toContain("wx.vibrateShort");
    expect(lobby).toContain('type: "heavy"');
    expect(lobby).not.toContain("PREVIEW_GAMES");
    expect(lobby).not.toContain("selectedGame");
    expect(lobby).not.toContain("onGameTap");
    expect(lobby).not.toContain("/domain/");
    expect(lobby).not.toContain("/games/");
    expect(lobby).not.toContain("room:state");
    expect(lobbyMarkup).toContain("moderatorLabel");
    expect(lobbyMarkup).toContain("gameLabel");
    expect(lobbyMarkup).toContain("已准备好");
    expect(lobbyMarkup).toContain("开始游戏");
  });

  it("documents separate product imports instead of a single root project", () => {
    expect(fs.existsSync("project.config.json")).toBe(false);
    const readme = text("miniprogram/README.md");
    expect(readme).toContain("wechat-build/werewolf");
    expect(readme).toContain("wechat-build/botc");
    expect(readme).toContain("骏骏桌游-狼人");
    expect(readme).toContain("骏骏桌游-血染");
    expect(readme).toContain("真实 AppID");
    expect(readme).toContain("request 合法域名");
    expect(readme).toContain("socket 合法域名");
  });
});
