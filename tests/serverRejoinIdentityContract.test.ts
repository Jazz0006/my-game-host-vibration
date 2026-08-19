import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { attachSocketIoClientProtocolTransport } from "../src/runtime/node/SocketIoClientProtocolTransport.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type SessionAck = {
  ok: true;
  roomId: string;
  playerId: string;
  seat: number;
  name?: string;
  resumeToken: string;
  isHost?: boolean;
};

type ResumeAck = {
  ok: true;
  roomId: string;
  playerId: string;
  seat: number;
  name?: string;
  isHost: boolean;
};

type AckFailure = { ok: false; message: string };

function waitFor<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, TIMEOUT_MS);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, payload, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

describe("C1 server rejoin identity contract", () => {
  let game: ReturnType<typeof createGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    game = createGameServer();
    attachSocketIoClientProtocolTransport(game);
    await new Promise<void>(resolve => game.httpServer.listen(0, "127.0.0.1", resolve));
    const address = game.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>(resolve => game.io.close(() => resolve()));
  });

  async function connect(): Promise<ClientSocket> {
    const socket = createClient(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("keeps playerId, host flag and assigned role stable when the socket is replaced mid-game", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const sessions: SessionAck[] = [];

    const hostSession = await emitAck<SessionAck>(host, "host:create-room", { name: "房主" });
    sessions.push(hostSession);
    for (let index = 1; index < sockets.length; index += 1) {
      sessions.push(
        await emitAck<SessionAck>(sockets[index]!, "player:join-room", {
          roomId: hostSession.roomId,
          name: `玩家${index + 1}`,
        }),
      );
    }

    expect(await emitAck<{ ok: boolean }>(
      host,
      "client:command",
      createClientCommandEnvelope("werewolf.startGame", {}, "rejoin-start-game"),
    )).toEqual({ ok: true });

    const targetIndex = 2;
    const targetSocket = sockets[targetIndex]!;
    const targetSession = sessions[targetIndex]!;
    const roomBefore = game.rooms.get(hostSession.roomId);
    const roleBefore = roomBefore?.game?.roles[targetSession.playerId];
    const hostFlagBefore = roomBefore?.players.find(player => player.id === targetSession.playerId)?.isHost;
    expect(roleBefore).toBeTruthy();
    expect(hostFlagBefore).toBe(false);

    const oldSocketId = targetSocket.id;
    targetSocket.disconnect();

    const replacement = await connect();
    const resumed = await emitAck<ResumeAck | AckFailure>(replacement, "player:resume", {
      roomId: targetSession.roomId,
      playerId: targetSession.playerId,
      resumeToken: targetSession.resumeToken,
    });

    expect(resumed).toMatchObject({
      ok: true,
      roomId: targetSession.roomId,
      playerId: targetSession.playerId,
      isHost: false,
    });

    const roomAfter = game.rooms.get(hostSession.roomId);
    const restoredPlayer = roomAfter?.players.find(player => player.id === targetSession.playerId);
    expect(restoredPlayer).toMatchObject({
      id: targetSession.playerId,
      connected: true,
      isHost: false,
      socketId: replacement.id,
    });
    expect(restoredPlayer?.socketId).not.toBe(oldSocketId);
    expect(roomAfter?.game?.roles[targetSession.playerId]).toBe(roleBefore);
    expect(roomAfter?.players).toHaveLength(5);
  });
});
