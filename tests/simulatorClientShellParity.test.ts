import fs from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string): string {
  return fs.readFileSync(path, "utf8");
}

describe("PV-UI1 Simulator pre-device client-shell parity", () => {
  it("covers the WeChat entry and recovery lifecycle through production simulator seams", () => {
    const index = text("miniprogram/pages/index/index.js");
    const lab = text("dev/labV2.js");
    const server = text("dev/SimulatorLabServer.ts");

    expect(index).toContain("createRoom()");
    expect(index).toContain("joinRoom(this.data.roomCode)");
    expect(index).toContain("startStoredSession()");

    expect(lab).toContain('"/dev/simulator/api/room/create"');
    expect(lab).toContain('"/dev/simulator/api/room/join"');
    expect(lab).toContain('"/dev/simulator/api/device/continue"');
    expect(lab).toContain("继续上次房间");
    expect(server).toContain('"/dev/simulator/api/devices/reset"');
    expect(server).toContain('"/dev/simulator/api/device/close"');
  });

  it("replaces stale phone-mirror DOM before rendering the selected client", () => {
    const lab = text("dev/labV2.js");
    const start = lab.indexOf("function renderPhone(client)");
    const end = lab.indexOf("function renderVirtualPlayers()", start);
    const renderPhone = lab.slice(start, end);

    expect(renderPhone).toContain("root.replaceChildren();");
    expect(renderPhone.indexOf("root.replaceChildren();")).toBeLessThan(
      renderPhone.indexOf("if (!client)"),
    );
  });

  it("treats the WeChat product UI as the selected-phone reference surface", () => {
    const html = text("dev/lab.html");
    const lab = text("dev/labV2.js");
    const css = text("dev/wechatReference.css");

    expect(html).toContain('/dev/assets/wechatReference.css');
    expect(lab).toContain('/client-runtime/client/RoundedTableLayout.js');
    expect(lab).toContain('appName: "骏骏桌游-血染"');
    expect(lab).not.toContain('"玩家名称"');
    expect(lab).toContain('"wechat-lobby-table-stage"');
    expect(lab).toContain("computeRoundedTableSeats(model.playerOrder, byId)");
    expect(lab).not.toContain('"wechat-seat-list"');
    expect(css).toContain(".wechat-index-page");
    expect(css).toContain(".wechat-lobby-table-stage");
    expect(css).toContain(".wechat-settings-page");
    expect(css).toContain(".wechat-game-page");
  });

  it("covers Lobby and room-management product actions in the phone mirror", () => {
    const lobby = text("miniprogram/pages/lobby.js");
    const settings = text("miniprogram/pages/settings.js");
    const lab = text("dev/labV2.js");
    const interactions = text("dev/wechatReferenceInteractions.js");
    const labSurface = lab + interactions;

    for (const command of [
      "room.setReady",
      "room.movePlayerSeat",
      "room.setGameModerator",
    ]) {
      expect(lobby).toContain(command);
      expect(labSurface).toContain(command);
    }

    expect(lobby).toContain("this._product.startCommand");
    expect(lab).toContain("botc.startGame");

    for (const command of ["room.transferHost", "room.removePlayer"]) {
      expect(settings).toContain(command);
      expect(lab).toContain(command);
    }

    expect(lobby).toContain("createClientLobbyPresentation");
    expect(settings).toContain("createClientLobbyPresentation");
    expect(lab).toContain("createClientLobbyPresentation");
  });

  it("keeps numeric private information on the shared WeChat/Simulator presentation seam", () => {
    const game = text("miniprogram/pages/game.js");
    const wxml = text("miniprogram/pages/game.wxml");
    const lab = text("dev/labV2.js");

    expect(game).toContain("privateInformationNumber");
    expect(game).toContain("hasPrivateInformationNumber");
    expect(wxml).toContain("hasPrivateInformationNumber");
    expect(wxml).toContain("你得知的数字是 {{privateInformationNumber}}");
    expect(lab).toContain("privateInformationNumber");
    expect(lab).toContain("你得知的数字是 ");
    expect(game).toContain("privateInformationBooleanLabel");
    expect(wxml).toContain("占卜结果：{{privateInformationBooleanLabel}}");
    expect(lab).toContain("占卜结果：");

    const products = text("scripts/wechat-products.mjs");
    expect(products).toContain('setRedHerringCommand: "botc.setRedHerring"');
    expect(game).toContain("redHerringOptions");
    expect(game).toContain("setRedHerringCommand");
    expect(wxml).toContain("选择占卜师的红鲱鱼");
    expect(lab).toContain('"botc.setRedHerring"');
    expect(lab).toContain("redHerringOptions");
  });

  it("keeps quick-table mode alongside the full-client mode", () => {
    const html = text("dev/lab.html");
    const lab = text("dev/labV2.js");

    expect(html).toContain('id="reset-devices"');
    expect(html).toContain("完整客户端模式");
    expect(html).toContain('id="reset-simulator"');
    expect(html).toContain("快速建立 N 人桌");
    expect(lab).toContain('"/dev/simulator/api/devices/reset"');
    expect(lab).toContain('"/dev/simulator/api/reset"');
  });
});
