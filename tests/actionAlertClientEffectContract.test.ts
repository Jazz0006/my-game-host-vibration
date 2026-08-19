import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("E2.3b action-alert legacy event contraction", () => {
  it("publishes action alerts only through the stable client:event effect boundary", () => {
    const delivery = source("src/runtime/node/SocketIoClientEffectDelivery.ts");

    expect(delivery).toContain('createClientVibrateEffectEvent([300, 150, 300]');
    expect(delivery).toContain('"client:event"');
    expect(delivery).toContain('reason: "action-alert"');
    expect(delivery).not.toContain('"player:action-alert"');
  });

  it("routes host resend reminders through the same canonical effect boundary", () => {
    const server = source("src/server.ts");
    expect(server).toContain("emitActionAlertEffects(io, room, { resumed: true })");
  });

  it("keeps the Web runtime on ClientSession effects without a legacy listener", () => {
    const app = source("public/app.js");
    const webSession = source("src/client/browser/WebClientSession.ts");
    const transport = source("src/client/browser/SocketIoRealtimeTransport.ts");

    expect(app).not.toContain('socket.on("player:action-alert"');
    expect(webSession).toContain("attachBrowserClientEffects(session)");
    expect(transport).toContain('socket.on("client:event", this.handleEvent)');
  });
});
