import fs from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(text(path)) as Record<string, unknown>;
}

describe("E3.7 WeChat Developer Tools shell", () => {
  it("declares a native miniprogram root with URL checks enabled", () => {
    const config = json("project.config.json");
    expect(config.miniprogramRoot).toBe("miniprogram/");
    expect(config.compileType).toBe("miniprogram");
    expect(config.appid).toBe("touristappid");
    expect(config.setting).toMatchObject({
      urlCheck: true,
      es6: true,
    });

    const app = json("miniprogram/app.json");
    expect(app.pages).toEqual(["pages/index/index"]);
  });

  it("builds the existing TypeScript client runtime as generated CommonJS modules", () => {
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

    const ignore = text(".gitignore");
    expect(ignore).toContain("miniprogram/runtime/");
    expect(ignore).toContain("project.private.config.json");
  });

  it("keeps the native page as a thin validation shell over the E3.6 composition", () => {
    const page = text("miniprogram/pages/index/index.js");
    expect(page).toContain('require("../../runtime/client/WeChatNativeClient.js")');
    expect(page).toContain('require("../../runtime/client/WeChatMinimalPageController.js")');
    expect(page).not.toContain("/domain/");
    expect(page).not.toContain("/games/");
    expect(page).not.toContain("ClientRawWebSocketProtocol");
    expect(page).not.toContain("SocketTask");
    expect(page).not.toContain("room:state");

    const markup = text("miniprogram/pages/index/index.wxml");
    expect(markup).toContain("Worker Base URL");
    expect(markup).toContain("Room ID");
    expect(markup).toContain("Player ID");
    expect(markup).toContain("Resume Token");
    expect(markup).toContain("Semantic command");
  });

  it("documents the real-device preconditions instead of claiming fake-wx coverage is device evidence", () => {
    const readme = text("miniprogram/README.md");
    expect(readme).toContain("真实 AppID");
    expect(readme).toContain("request 合法域名");
    expect(readme).toContain("socket 合法域名");
    expect(readme).toContain("真机");
    expect(readme).toContain("npm run build:wechat");
  });
});
