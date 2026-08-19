import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientStateEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { createTimedGameServer } from "../src/timedServer.js";

const TIMEOUT_MS = 3000;

type SessionResult = {
  ok: true;
  roomId: string;
  playerId: string;
  resumeToken: string;
};

type PlayerView = {
  phase: string;
  mode: string;
};

type ClientStateDelivery = {
  revision: number;
  envelope: ClientStateEnvelope<PlayerView>;
};

type ClientStateSyncResult =
  | ({ ok: true } & ClientStateDelivery)
  | { ok: false; message: string };

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

describe("E2.2b2a Socket.IO authoritative client state", () => {
  let game: ReturnType<typeof createTimedGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    game = createTimedGameServer();
    await new Promise<void>(resolve => game.httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(game.httpServer.address() as AddressInfo).port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    game.stopInteractionTimeouts();
    await new Promise<void>(resolve => game.io.close(() => resolve()));
  });

  async function connect(): Promise<ClientSocket> {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("mirrors authoritative PlayerView with monotonic revision and syncs the latest view", async () => {
    const host = await connect();
    const initialState = waitFor<ClientStateDelivery>(host, "client:state");
    const session = await emitAck<SessionResult>(host, "host:create-room", { name: "房主" });
    const first = await initialState;

    expect(first.revision).toBe(1);
    expect(first.envelope).toMatchObject({
      protocolVersion: 1,
      kind: "state",
      scope: "player",
      roomId: session.roomId,
      playerId: session.playerId,
      payload: { phase: "lobby", mode: "lobby" },
    });

    const firstSync = await emitAck<ClientStateSyncResult>(host, "client:sync-state", {});
    expect(firstSync).toEqual({ ok: true, ...first });

    const updatedState = waitFor<ClientStateDelivery>(
      host,
      "client:state",
      value => value.revision > first.revision,
    );
    expect(
      await emitAck<{ ok: boolean; name?: string }>(host, "player:update-name", { name: "新房主名" }),
    ).toMatchObject({ ok: true, name: "新房主名" });
    const second = await updatedState;
    expect(second.revision).toBeGreaterThan(first.revision);

    host.disconnect();
    const replacement = await connect();
    const resumedState = waitFor<ClientStateDelivery>(
      replacement,
      "client:state",
      value => value.envelope.playerId === session.playerId,
    );
    expect(
      await emitAck<{ ok: boolean }>(replacement, "player:resume", {
        roomId: session.roomId,
        playerId: session.playerId,
        resumeToken: session.resumeToken,
      }),
    ).toMatchObject({ ok: true });

    const third = await resumedState;
    expect(third.revision).toBeGreaterThan(second.revision);
    expect(third.envelope.roomId).toBe(session.roomId);
    expect(third.envelope.playerId).toBe(session.playerId);

    const resumedSync = await emitAck<ClientStateSyncResult>(replacement, "client:sync-state", {});
    expect(resumedSync).toEqual({ ok: true, ...third });
  });

  it("rejects state sync before the socket has authenticated room membership", async () => {
    const socket = await connect();
    expect(await emitAck<ClientStateSyncResult>(socket, "client:sync-state", {})).toEqual({
      ok: false,
      message: "你当前不在房间中",
    });
  });
});
