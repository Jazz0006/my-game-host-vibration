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
  type ClientRealtimeEventEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type Session = {
  ok: true;
  roomId: string;
  playerId: string;
  seat: number;
  name: string;
};
type Ack = { ok: true } | { ok: false; message: string };

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

describe("E2.3e3 room lifecycle delivery", () => {
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
    const socket = createClient(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
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

  it("delivers stable room removal event to the removed player", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const stable = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_REMOVED, ClientRoomRemovedPayload>
    >(player, "client:event", event => event.type === CLIENT_ROOM_REMOVED);

    expect(await emitAck<Ack>(host, "host:remove-player", {
      targetPlayerId: playerSession.playerId,
    })).toEqual({ ok: true });

    expect(await stable).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event",
      type: CLIENT_ROOM_REMOVED,
      payload: { roomId: hostSession.roomId, reason: "removed" },
    });
    expect(game.rooms.get(hostSession.roomId)?.players).toHaveLength(1);
  });

  it("delivers stable room closed event to every room member", async () => {
    const { host, player, hostSession } = await createRoomWithPlayer();
    const hostStable = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_CLOSED, ClientRoomClosedPayload>
    >(host, "client:event", event => event.type === CLIENT_ROOM_CLOSED);
    const playerStable = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_CLOSED, ClientRoomClosedPayload>
    >(player, "client:event", event => event.type === CLIENT_ROOM_CLOSED);

    expect(await emitAck<Ack>(host, "host:close-room", {})).toEqual({ ok: true });

    const expectedStable = {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event" as const,
      type: CLIENT_ROOM_CLOSED,
      payload: { roomId: hostSession.roomId, reason: "host_closed" as const },
    };
    expect(await hostStable).toEqual(expectedStable);
    expect(await playerStable).toEqual(expectedStable);
    expect(game.rooms.has(hostSession.roomId)).toBe(false);
  });
});
