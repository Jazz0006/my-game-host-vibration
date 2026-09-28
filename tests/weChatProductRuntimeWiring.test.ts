import fs from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string): string {
  return fs.readFileSync(path, "utf8");
}

describe("E3.7B WeChat product runtime wiring", () => {
  it("owns one native client at the app composition boundary with the production Worker URL", () => {
    const app = text("miniprogram/app.js");
    expect(app).toContain('require("./runtime/client/WeChatNativeClient.js")');
    expect(app).toContain("createWeChatNativeClientFromGlobal");
    expect(app).toContain("https://my-game-host-vibration.jazz-zeng.workers.dev");
    expect(app).toContain("getGameClient");
  });

  it("uses real create/join/resume intents from the product entry page", () => {
    const entry = text("miniprogram/pages/index/index.js");
    expect(entry).toContain("getGameClient");
    expect(entry).toContain(".createRoom(");
    expect(entry).toContain(".joinRoom(");
    expect(entry).toContain(".startStoredSession(");
    expect(entry).not.toContain("创建房间将在 authority 接线后启用");
    expect(entry).not.toContain("加入房间将在 authority 接线后启用");
  });

  it("renders the authoritative public room projection and sends startGame only through the native client", () => {
    const lobby = text("miniprogram/pages/lobby.js");
    expect(lobby).toContain("getGameClient");
    expect(lobby).toContain(".subscribe(");
    expect(lobby).toContain("view.room");
    expect(lobby).toContain('sendCommand("werewolf.startGame"');
    expect(lobby).not.toContain("ClientRawWebSocketProtocol");
    expect(lobby).not.toContain("connectSocket");
    expect(lobby).not.toContain("room:state");
  });
});
