import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type SessionResult = {
  ok: true;
  roomId: string;
  playerId: string;
  resumeToken: string;
};
type BasicResult = { ok: boolean; message?: string };
type RecoveryGrantResult =
  | { ok: true; recoveryCode: string; expiresAt: number }
  | { ok: false; message: string };
type RecoveryClaimResult =
  | { ok: true; roomId: string; playerId: string; resumeToken: string }
  | { ok: false; message: string };

function emitAck<T>(socket: ClientSocket, event: string, payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, payload, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe("C4.3 Socket.IO identity recovery", () => {
  let game: ReturnType<typeof createGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    game = createGameServer();
    await new Promise<void>(resolve => game.httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(game.httpServer.address() as AddressInfo).port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>(resolve => game.io.close(() => resolve()));
  });

  async function connect(): Promise<ClientSocket> {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect timeout")), TIMEOUT_MS);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return socket;
  }

  it("restores an offline player once, rotates the long-lived token, and blocks unauthorized takeover", async () => {
    const host = await connect();
    const target = await connect();
    const other = await connect();

    const hostSession = await emitAck<SessionResult>(host, "host:create-room", { name: "房主" });
    const targetSession = await emitAck<SessionResult>(target, "player:join-room", {
      roomId: hostSession.roomId,
      name: "掉线玩家",
    });
    const otherSession = await emitAck<SessionResult>(other, "player:join-room", {
      roomId: hostSession.roomId,
      name: "其他玩家",
    });

    expect(
      await emitAck<RecoveryGrantResult>(other, "host:create-identity-recovery", {
        targetPlayerId: targetSession.playerId,
      }),
    ).toEqual({ ok: false, message: "只有房主可以协助恢复身份" });

    expect(
      await emitAck<RecoveryGrantResult>(host, "host:create-identity-recovery", {
        targetPlayerId: otherSession.playerId,
      }),
    ).toEqual({ ok: false, message: "该玩家当前在线，不需要恢复身份" });

    target.disconnect();
    await waitUntil(() => {
      const room = game.rooms.get(hostSession.roomId);
      return room?.players.find(player => player.id === targetSession.playerId)?.connected === false;
    });

    const grant = await emitAck<RecoveryGrantResult>(host, "host:create-identity-recovery", {
      targetPlayerId: targetSession.playerId,
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) throw new Error(grant.message);
    expect(grant.recoveryCode.length).toBeGreaterThanOrEqual(10);
    expect(grant.expiresAt).toBeGreaterThan(Date.now());

    const wrongDevice = await connect();
    expect(
      await emitAck<RecoveryClaimResult>(wrongDevice, "player:claim-identity-recovery", {
        roomId: hostSession.roomId,
        recoveryCode: `${grant.recoveryCode}x`,
      }),
    ).toEqual({ ok: false, message: "恢复码无效或已过期" });

    const recovered = await connect();
    const claim = await emitAck<RecoveryClaimResult>(recovered, "player:claim-identity-recovery", {
      roomId: hostSession.roomId,
      recoveryCode: grant.recoveryCode,
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error(claim.message);
    expect(claim.playerId).toBe(targetSession.playerId);
    expect(claim.resumeToken).not.toBe(targetSession.resumeToken);

    const replayDevice = await connect();
    expect(
      await emitAck<RecoveryClaimResult>(replayDevice, "player:claim-identity-recovery", {
        roomId: hostSession.roomId,
        recoveryCode: grant.recoveryCode,
      }),
    ).toEqual({ ok: false, message: "恢复码无效或已过期" });

    recovered.disconnect();
    await waitUntil(() => {
      const room = game.rooms.get(hostSession.roomId);
      return room?.players.find(player => player.id === targetSession.playerId)?.connected === false;
    });

    const oldTokenDevice = await connect();
    expect(
      await emitAck<BasicResult>(oldTokenDevice, "player:resume", {
        roomId: hostSession.roomId,
        playerId: targetSession.playerId,
        resumeToken: targetSession.resumeToken,
      }),
    ).toEqual({ ok: false, message: "恢复凭证无效" });

    const newTokenDevice = await connect();
    const resumed = await emitAck<BasicResult>(newTokenDevice, "player:resume", {
      roomId: hostSession.roomId,
      playerId: targetSession.playerId,
      resumeToken: claim.resumeToken,
    });
    expect(resumed.ok).toBe(true);
  });
});
