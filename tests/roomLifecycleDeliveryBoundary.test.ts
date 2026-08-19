import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("E2.3e2 room lifecycle delivery boundary", () => {
  it("routes stable room lifecycle events through the Node adapter", () => {
    const delivery = source("src/runtime/node/SocketIoClientRoomEventDelivery.ts");
    const server = source("src/server.ts");

    expect(delivery).toContain('socket.emit("client:event", createClientRoomRemovedEvent(roomId))');
    expect(delivery).toContain('io.to(roomId).emit("client:event", createClientRoomClosedEvent(roomId))');
    expect(server).toContain("emitClientRoomRemoved(targetSocket, membership.room.id)");
    expect(server).toContain("emitClientRoomClosed(io, roomId)");
  });

  it("keeps raw room lifecycle events only for the E2.3e2 Web migration window", () => {
    const server = source("src/server.ts");
    const web = source("public/app.js");

    expect(server).toContain('targetSocket.emit("room:removed"');
    expect(server).toContain('io.to(roomId).emit("room:closed"');
    expect(web).toContain('socket.on("room:removed"');
    expect(web).toContain('socket.on("room:closed"');
  });
});
