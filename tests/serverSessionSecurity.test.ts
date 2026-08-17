import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type SessionAck = {
  ok: true;
  roomId: string;
  playerId: string;
  resumeToken: string;
};

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, payload, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

describe("server session security contract", () => {
  let game: ReturnType<typeof createGameServer>;
  let client: ClientSocket;

  beforeEach(async () => {
    game = createGameServer();
    await new Promise<void>(resolve => game.httpServer.listen(0, "127.0.0.1", resolve));
    const address = game.httpServer.address() as AddressInfo;
    client = createClient(`http://127.0.0.1:${address.port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    if (!client.connected) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out connecting")), TIMEOUT_MS);
        client.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });

  afterEach(async () => {
    client.disconnect();
    await new Promise<void>(resolve => game.io.close(() => resolve()));
  });

  it("returns the raw resume token only to the client and stores only its SHA-256 hash", async () => {
    const session = await emitAck<SessionAck>(client, "host:create-room", { name: "房主" });
    const stored = game.rooms
      .get(session.roomId)
      ?.players.find(player => player.id === session.playerId);

    expect(session.resumeToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(stored?.resumeTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored?.resumeTokenHash).not.toBe(session.resumeToken);
    expect(JSON.stringify(stored)).not.toContain(session.resumeToken);
  });

  it("does not replace a valid session when resume verification fails", async () => {
    const session = await emitAck<SessionAck>(client, "host:create-room", { name: "房主" });
    const original = game.rooms
      .get(session.roomId)
      ?.players.find(player => player.id === session.playerId);
    const originalSocketId = original?.socketId;

    const attacker = createClient(`http://127.0.0.1:${(game.httpServer.address() as AddressInfo).port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    try {
      if (!attacker.connected) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timed out connecting attacker")), TIMEOUT_MS);
          attacker.once("connect", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      const result = await emitAck<{ ok: false; message: string }>(attacker, "player:resume", {
        roomId: session.roomId,
        playerId: session.playerId,
        resumeToken: "invalid-token",
      });

      expect(result).toEqual({ ok: false, message: "恢复凭证无效" });
      expect(original).toMatchObject({ connected: true, socketId: originalSocketId });
    } finally {
      attacker.disconnect();
    }
  });
});
