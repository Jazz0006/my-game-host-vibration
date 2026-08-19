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

describe("E2.3e3 room lifecycle delivery boundary", () => {
  it("routes stable room lifecycle events through the Node adapter", () => {
    const delivery = source("src/runtime/node/SocketIoClientRoomEventDelivery.ts");
    const server = source("src/server.ts");

    expect(delivery).toContain('socket.emit("client:event", createClientRoomRemovedEvent(roomId))');
    expect(delivery).toContain('io.to(roomId).emit("client:event", createClientRoomClosedEvent(roomId))');
    expect(server).toContain("emitClientRoomRemoved(targetSocket, membership.room.id)");
    expect(server).toContain("emitClientRoomClosed(io, roomId)");
  });

  it("retires raw room lifecycle Socket.IO events from server, Web, and inventory", () => {
    const server = source("src/server.ts");
    const web = source("public/app.js");
    const inventory = source("src/protocol/client/LegacySocketIoSurface.ts");

    expect(server).not.toContain('targetSocket.emit("room:removed"');
    expect(server).not.toContain('io.to(roomId).emit("room:closed"');
    expect(web).not.toContain('socket.on("room:removed"');
    expect(web).not.toContain('socket.on("room:closed"');
    expect(inventory).not.toContain('event: "room:removed"');
    expect(inventory).not.toContain('event: "room:closed"');
  });

  it("wires production Web room lifecycle handling through ClientSession", () => {
    const web = source("public/app.js");
    const adapter = source("src/client/browser/BrowserSessionEvents.ts");

    expect(web).toContain("attachBrowserRoomLifecycle");
    expect(web).toContain('returnToEntry("你已被房主移出房间")');
    expect(web).toContain('returnToEntry("房主已关闭房间")');
    expect(adapter).toContain("CLIENT_ROOM_REMOVED");
    expect(adapter).toContain("CLIENT_ROOM_CLOSED");
  });
});
