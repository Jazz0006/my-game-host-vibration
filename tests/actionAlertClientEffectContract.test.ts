import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("E2.2c2 action-alert client effect migration", () => {
  it("dual-publishes the action alert from the canonical Node effect delivery boundary", () => {
    const delivery = source("src/runtime/node/SocketIoClientEffectDelivery.ts");

    expect(delivery).toContain('createClientVibrateEffectEvent([300, 150, 300]');
    expect(delivery).toContain('"client:event"');
    expect(delivery).toContain('reason: "action-alert"');
    expect(delivery).toContain('emit("player:action-alert", context)');
  });

  it("routes host resend reminders through the same canonical effect boundary", () => {
    const server = source("src/server.ts");
    expect(server).toContain("emitActionAlertEffects(io, room, { resumed: true })");
  });

  it("makes the new Web runtime consume action vibration only through ClientSession effects", () => {
    const app = source("public/app.js");
    const webSession = source("src/client/browser/WebClientSession.ts");
    const transport = source("src/client/browser/SocketIoRealtimeTransport.ts");

    expect(app).not.toContain('socket.on("player:action-alert"');
    expect(webSession).toContain("attachBrowserClientEffects(session)");
    expect(transport).toContain('socket.on("client:event", this.handleEvent)');
  });
});
