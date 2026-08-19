import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("E2.2c2 action-alert client effect migration", () => {
  it("dual-publishes the action alert as a client effect while retaining the legacy server event", () => {
    const server = source("src/server.ts");

    expect(server).toContain('createClientVibrateEffectEvent([300, 150, 300]');
    expect(server).toContain('"client:event"');
    expect(server).toContain('reason: "action-alert"');
    expect(server).toContain('emit("player:action-alert", context)');
  });

  it("routes host resend reminders through the same dual-publish action alert helper", () => {
    const server = source("src/server.ts");
    const handlerStart = server.indexOf('socket.on(\n      "host:resend-current-action"');
    const handlerEnd = server.indexOf('socket.on(', handlerStart + 1);
    const handler = server.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handler).toContain("alertCurrentActors(io, room, true)");
    expect(handler).not.toContain('emit("player:action-alert"');
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
