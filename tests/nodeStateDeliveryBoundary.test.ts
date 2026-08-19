import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("E2.3c2 canonical Node private state delivery boundary", () => {
  it("delivers private PlayerView only through client:state", () => {
    const delivery = source("src/runtime/node/SocketIoClientStateDelivery.ts");

    expect(delivery).toContain('socket.emit("client:state", delivery)');
    expect(delivery).not.toContain('socket.emit("player:game-state"');
    expect(delivery).toContain("advanceNodeClientStateRevision(room, playerId)");
  });

  it("keeps the retired private state event out of runtime, production Web, and the surface inventory", () => {
    const protocolTransport = source("src/runtime/node/SocketIoClientProtocolTransport.ts");
    const server = source("src/server.ts");
    const web = source("public/app.js");
    const inventory = source("src/protocol/client/LegacySocketIoSurface.ts");

    expect(protocolTransport).not.toContain("onAnyOutgoing");
    expect(protocolTransport).not.toContain('"player:game-state"');
    expect(protocolTransport).toContain("currentClientStateDelivery(");

    expect(server).toContain('from "./runtime/node/SocketIoClientStateDelivery.js"');
    expect(server).toContain("emitPrivatePlayerState(io, room, player.id);");
    expect(server).not.toContain('emit("player:game-state"');
    expect(web).not.toContain('"player:game-state"');
    expect(web).not.toContain("'player:game-state'");
    expect(inventory).not.toContain('{ event: "player:game-state"');
  });
});
