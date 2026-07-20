import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type Session = { ok: true; roomId: string; playerId: string; seat: number };
type Ack = { ok: true } | { ok: false; message: string };
type RoomView = {
  viewer: { playerId: string; isHost: boolean };
  players: Array<{ id: string; isHost: boolean }>;
};

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, TIMEOUT_MS);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
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

describe("room member management", () => {
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

  async function connect() {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  async function createRoomWithPlayer() {
    const host = await connect();
    const player = await connect();
    const hostSession = await emitAck<Session>(host, "host:create-room", { name: "房主" });
    const playerSession = await emitAck<Session>(player, "player:join-room", {
      roomId: hostSession.roomId,
      name: "玩家二号",
    });
    return { host, player, hostSession, playerSession };
  }

  it("lets the host remove a player and reuses the released seat", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const removed = waitFor<{ reason: string }>(player, "room:removed");
    const updated = waitFor<RoomView>(
      host,
      "room:state",
      state => !state.players.some(item => item.id === playerSession.playerId),
    );

    expect(
      await emitAck<Ack>(host, "host:remove-player", { targetPlayerId: playerSession.playerId }),
    ).toEqual({ ok: true });
    expect(await removed).toEqual({ roomId: hostSession.roomId, reason: "removed" });
    expect((await updated).players).toHaveLength(1);

    const rejoined = await emitAck<Session>(player, "player:join-room", {
      roomId: hostSession.roomId,
      name: "重新加入",
    });
    expect(rejoined.seat).toBe(2);
  });

  it("transfers ownership and requires the old host to transfer before leaving", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const blocked = await emitAck<Ack>(host, "player:leave-room", {});
    expect(blocked).toEqual({ ok: false, message: "请先指定新的房主，再退出房间" });

    const becameHost = waitFor<RoomView>(
      player,
      "room:state",
      state => state.viewer.isHost,
    );
    expect(
      await emitAck<Ack>(host, "host:transfer-host", { targetPlayerId: playerSession.playerId }),
    ).toEqual({ ok: true });
    expect((await becameHost).players.find(item => item.id === playerSession.playerId)?.isHost).toBe(true);

    const oldHostLeft = waitFor<RoomView>(
      player,
      "room:state",
      state => !state.players.some(item => item.id === hostSession.playerId),
    );
    expect(await emitAck<Ack>(host, "player:leave-room", {})).toEqual({ ok: true });
    expect((await oldHostLeft).players).toHaveLength(1);
  });

  it("lets a non-host exit and removes an empty host-only room", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const updated = waitFor<RoomView>(
      host,
      "room:state",
      state => !state.players.some(item => item.id === playerSession.playerId),
    );
    expect(await emitAck<Ack>(player, "player:leave-room", {})).toEqual({ ok: true });
    await updated;

    expect(await emitAck<Ack>(host, "player:leave-room", {})).toEqual({ ok: true });
    expect(game.rooms.has(hostSession.roomId)).toBe(false);
  });
});
