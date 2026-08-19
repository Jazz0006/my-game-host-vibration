import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("E2.3a canonical Node realtime effect delivery boundary", () => {
  it("keeps compatibility event names isolated in SocketIoClientEffectDelivery", () => {
    const delivery = source("src/runtime/node/SocketIoClientEffectDelivery.ts");
    const server = source("src/server.ts");
    const protocolTransport = source("src/runtime/node/SocketIoClientProtocolTransport.ts");
    const timedServer = source("src/timedServer.ts");

    for (const eventName of [
      '"player:action-alert"',
      '"game:night-complete"',
      '"game:over"',
    ]) {
      expect(delivery).toContain(eventName);
      expect(server).not.toContain(eventName);
      expect(protocolTransport).not.toContain(eventName);
      expect(timedServer).not.toContain(eventName);
    }
  });

  it("makes legacy handlers, protocol commands, and timeout recovery reuse the shared boundary", () => {
    const server = source("src/server.ts");
    const protocolTransport = source("src/runtime/node/SocketIoClientProtocolTransport.ts");
    const timedServer = source("src/timedServer.ts");

    expect(server).toContain('from "./runtime/node/SocketIoClientEffectDelivery.js"');
    expect(protocolTransport).toContain('from "./SocketIoClientEffectDelivery.js"');
    expect(timedServer).toContain('from "./runtime/node/SocketIoClientEffectDelivery.js"');

    expect(protocolTransport).toContain("emitActionAlertEffects(io, room)");
    expect(protocolTransport).toContain("emitNightCompleteEffects(io, room)");
    expect(protocolTransport).toContain("emitGameOverEffects(io, room)");

    expect(timedServer).toContain(
      "emitActionAlertEffects(io, room, { timeoutWarning: true })",
    );
  });
});
