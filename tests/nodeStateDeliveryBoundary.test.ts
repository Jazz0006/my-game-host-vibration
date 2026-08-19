import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("E2.3c1 canonical Node private state delivery boundary", () => {
  it("makes SocketIoClientStateDelivery the source of stable and compatibility PlayerView pushes", () => {
    const delivery = source("src/runtime/node/SocketIoClientStateDelivery.ts");

    expect(delivery).toContain('socket.emit("client:state", delivery)');
    expect(delivery).toContain('socket.emit("player:game-state", envelope.payload)');
    expect(delivery).toContain("advanceNodeClientStateRevision(room, playerId)");
  });

  it("removes the outgoing-event shadow bridge from protocol transport", () => {
    const protocolTransport = source("src/runtime/node/SocketIoClientProtocolTransport.ts");
    const server = source("src/server.ts");

    expect(protocolTransport).not.toContain("onAnyOutgoing");
    expect(protocolTransport).not.toContain('"player:game-state"');
    expect(protocolTransport).toContain("currentClientStateDelivery(");

    expect(server).toContain('from "./runtime/node/SocketIoClientStateDelivery.js"');
    expect(server).toContain("emitPrivatePlayerState(io, room, player.id);");
    expect(server).not.toContain('emit("player:game-state"');
  });
});
