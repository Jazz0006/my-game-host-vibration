import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("E2.3b canonical Node realtime effect delivery boundary", () => {
  it("keeps retired legacy effect event names out of runtime and inventory", () => {
    const sources = [
      source("src/runtime/node/SocketIoClientEffectDelivery.ts"),
      source("src/runtime/node/SocketIoClientProtocolTransport.ts"),
      source("src/protocol/client/LegacySocketIoSurface.ts"),
      source("src/server.ts"),
      source("src/timedServer.ts"),
      source("public/app.js"),
    ];

    for (const eventName of [
      '"player:action-alert"',
      '"game:night-complete"',
      '"game:over"',
    ]) {
      for (const runtimeSource of sources) {
        expect(runtimeSource).not.toContain(eventName);
      }
    }
  });

  it("keeps legacy handlers, protocol commands, and timeout recovery on the shared stable boundary", () => {
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
