import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_ROOM_CLOSED,
  CLIENT_ROOM_REMOVED,
  type ClientRoomClosedPayload,
  type ClientRoomRemovedPayload,
} from "../src/protocol/client/ClientRoomEvents.js";
import {
  CLIENT_PROTOCOL_VERSION,
  createClientCommandEnvelope,
  type ClientRealtimeEventEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { attachSocketIoClientProtocolTransport } from "../src/runtime/node/SocketIoClientProtocolTransport.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type Session = { ok: true; roomId: string; playerId: string; seat: number; name: string };
type Ack = { ok: true } | { ok: false; message: string };
type RoomView = {
  viewer: { playerId: string; isHost: boolean };
  players: Array<{ id: string; name: string; seat: number; isHost: boolean }>;
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

function startGame(socket: ClientSocket, commandId: string): Promise<Ack> {
  return emitAck(
    socket,
    "client:command",
    createClientCommandEnvelope("werewolf.startGame", {}, commandId),
  );
}

describe("room member management", () => {
  let game: ReturnType<typeof createGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    game = createGameServer();
    attachSocketIoClientProtocolTransport(game);
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

  it("assigns and returns unique default names when clients do not provide one", async () => {
    const host = await connect();
    const second = await connect();
    const third = await connect();
    const hostSession = await emitAck<Session>(host, "host:create-room", {});
    const secondSession = await emitAck<Session>(second, "player:join-room", {
      roomId: hostSession.roomId,
    });
    const thirdSession = await emitAck<Session>(third, "player:join-room", {
      roomId: hostSession.roomId,
      name: "新玩家一号",
    });

    expect(hostSession.name).toBe("新玩家一号");
    expect(secondSession.name).toBe("新玩家二号");
    expect(thirdSession.name).toBe("新玩家三号");
    expect(game.rooms.get(hostSession.roomId)?.players.map(player => player.name)).toEqual([
      "新玩家一号",
      "新玩家二号",
      "新玩家三号",
    ]);
  });

  it("lets a player rename themselves and broadcasts the new saved name", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const renamed = waitFor<RoomView>(
      host,
      "room:state",
      state => state.players.some(item => item.id === playerSession.playerId && item.name === "小明"),
    );

    expect(await emitAck<{ ok: true; name: string } | { ok: false; message: string }>(
      player,
      "player:update-name",
      { name: "  小明  " },
    )).toEqual({ ok: true, name: "小明" });
    expect((await renamed).players.find(item => item.id === playerSession.playerId)?.name).toBe("小明");
    expect(await emitAck<Ack>(host, "player:update-name", { name: "小明" })).toEqual({
      ok: false,
      message: "这个名字已被房间里的其他玩家使用",
    });
    expect(await emitAck<Ack>(player, "player:update-name", { name: " " })).toEqual({
      ok: false,
      message: "名字不能为空",
    });
    expect(game.rooms.get(hostSession.roomId)?.players.find(
      item => item.id === playerSession.playerId,
    )?.name).toBe("小明");
  });

  it("closes seat gaps after removal and appends new players at the end", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const third = await connect();
    const thirdSession = await emitAck<Session>(third, "player:join-room", {
      roomId: hostSession.roomId,
      name: "玩家三号",
    });
    const removed = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_REMOVED, ClientRoomRemovedPayload>
    >(player, "client:event", event => event.type === CLIENT_ROOM_REMOVED);
    const updated = waitFor<RoomView>(
      host,
      "room:state",
      state => !state.players.some(item => item.id === playerSession.playerId),
    );

    expect(
      await emitAck<Ack>(host, "host:remove-player", { targetPlayerId: playerSession.playerId }),
    ).toEqual({ ok: true });
    expect(await removed).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event",
      type: CLIENT_ROOM_REMOVED,
      payload: { roomId: hostSession.roomId, reason: "removed" },
    });
    expect((await updated).players.map(item => ({ id: item.id, seat: item.seat }))).toEqual([
      { id: hostSession.playerId, seat: 1 },
      { id: thirdSession.playerId, seat: 2 },
    ]);

    const rejoined = await emitAck<Session>(player, "player:join-room", {
      roomId: hostSession.roomId,
      name: "重新加入",
    });
    expect(rejoined.seat).toBe(3);
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

  it("atomically transfers ownership and removes the departing host", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const transferred = waitFor<RoomView>(
      player,
      "room:state",
      state => state.viewer.isHost && !state.players.some(item => item.id === hostSession.playerId),
    );

    expect(await emitAck<Ack>(host, "host:leave-and-transfer", {
      targetPlayerId: playerSession.playerId,
    })).toEqual({ ok: true });
    expect((await transferred).players.map(item => ({ id: item.id, seat: item.seat }))).toEqual([
      { id: playerSession.playerId, seat: 1 },
    ]);

    const newRoom = await emitAck<Session>(host, "host:create-room", { name: "原房主" });
    expect(newRoom.roomId).not.toBe(hostSession.roomId);
  });

  it("lets only the host close an active room and notifies every member", async () => {
    const { host, player, hostSession } = await createRoomWithPlayer();
    for (const name of ["玩家三号", "玩家四号", "玩家五号"]) {
      const extra = await connect();
      await emitAck<Session>(extra, "player:join-room", {
        roomId: hostSession.roomId,
        name,
      });
    }
    expect(await startGame(host, "close-room-start-game")).toEqual({ ok: true });
    expect(await emitAck<Ack>(player, "host:close-room", {})).toEqual({
      ok: false,
      message: "只有房主可以关闭房间",
    });

    const hostClosed = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_CLOSED, ClientRoomClosedPayload>
    >(host, "client:event", event => event.type === CLIENT_ROOM_CLOSED);
    const playerClosed = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_CLOSED, ClientRoomClosedPayload>
    >(player, "client:event", event => event.type === CLIENT_ROOM_CLOSED);
    expect(await emitAck<Ack>(host, "host:close-room", {})).toEqual({ ok: true });
    const expectedClosed = {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event" as const,
      type: CLIENT_ROOM_CLOSED,
      payload: { roomId: hostSession.roomId, reason: "host_closed" as const },
    };
    expect(await hostClosed).toEqual(expectedClosed);
    expect(await playerClosed).toEqual(expectedClosed);
    expect(game.rooms.has(hostSession.roomId)).toBe(false);
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

  it("lets only the host reorder seats and broadcasts continuous seat numbers", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const third = await connect();
    const thirdSession = await emitAck<Session>(third, "player:join-room", {
      roomId: hostSession.roomId,
      name: "玩家三号",
    });
    const expectedOrder = [thirdSession.playerId, hostSession.playerId, playerSession.playerId];
    const hostMoved = waitFor<RoomView>(host, "room:state", state =>
      state.players.map(item => item.id).join(",") === expectedOrder.join(","),
    );
    const playerMoved = waitFor<RoomView>(player, "room:state", state =>
      state.players.map(item => item.id).join(",") === expectedOrder.join(","),
    );

    expect(await emitAck<Ack>(host, "host:move-player-seat", {
      targetPlayerId: thirdSession.playerId,
      insertIndex: 0,
    })).toEqual({ ok: true });
    expect((await hostMoved).players.map(item => ({ id: item.id, seat: item.seat }))).toEqual([
      { id: thirdSession.playerId, seat: 1 },
      { id: hostSession.playerId, seat: 2 },
      { id: playerSession.playerId, seat: 3 },
    ]);
    expect((await playerMoved).players.map(item => item.id)).toEqual(expectedOrder);

    expect(await emitAck<Ack>(player, "host:move-player-seat", {
      targetPlayerId: playerSession.playerId,
      insertIndex: 0,
    })).toEqual({ ok: false, message: "只有房主可以调整座位" });
    expect(await emitAck<Ack>(host, "host:move-player-seat", {
      targetPlayerId: playerSession.playerId,
      insertIndex: 99,
    })).toEqual({ ok: false, message: "目标座位无效" });
    expect(await emitAck<Ack>(host, "host:move-player-seat", {
      targetPlayerId: "missing-player",
      insertIndex: 0,
    })).toEqual({ ok: false, message: "玩家不存在" });
  });

  it("locks the seat order after the game starts", async () => {
    const { host, hostSession, playerSession } = await createRoomWithPlayer();
    for (const name of ["玩家三号", "玩家四号", "玩家五号"]) {
      const player = await connect();
      await emitAck<Session>(player, "player:join-room", {
        roomId: hostSession.roomId,
        name,
      });
    }

    expect(await startGame(host, "seat-lock-start-game")).toEqual({ ok: true });
    expect(await emitAck<Ack>(host, "host:move-player-seat", {
      targetPlayerId: playerSession.playerId,
      insertIndex: 0,
    })).toEqual({ ok: false, message: "游戏开始后不能调整座位" });
  });
});
