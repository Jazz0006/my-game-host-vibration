import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_INTERACTION_TIMEOUT_STATE,
  type ClientInteractionTimeoutStatePayload,
} from "../src/protocol/client/ClientInteractionTimeoutEvents.js";
import {
  createClientCommandEnvelope,
  type ClientRealtimeEventEnvelope,
  type ClientStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { createTimedGameServer } from "../src/timedServer.js";

const TIMEOUT_MS = 4000;
let commandSequence = 0;

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

function emitAck<T>(
  socket: ClientSocket,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(
      event,
      { commandId: `c45-command-${commandSequence++}`, ...payload },
      (error: Error | null, result: T) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

function confirmRole(socket: ClientSocket, actionId: string): Promise<BasicResult> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(
      "client:command",
      createClientCommandEnvelope(
        "werewolf.confirmRole",
        { actionId },
        `c45-confirm-${commandSequence++}`,
      ),
      (error: Error | null, result: BasicResult) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

type JoinResult = { ok: true; roomId: string; playerId: string };
type BasicResult = { ok: boolean; message?: string };
type GameView = {
  mode: string;
  role: "werewolf" | "guard" | "witch" | "seer" | "hunter" | "villager";
  actionId: string;
};
type ClientStateDelivery = {
  revision: number;
  envelope: ClientStateEnvelope<GameView>;
};
type RoomState = {
  roomId: string;
  viewer: { playerId: string; isHost: boolean };
  players: Array<{ id: string; seat: number; isHost: boolean; connected: boolean }>;
  roleCatalog?: Array<{ id: string; name: string }>;
  defaultRoleDeck?: string[];
  game: { phase: string; canStart: boolean };
};
type StableTimeoutStateEvent = ClientRealtimeEventEnvelope<
  typeof CLIENT_INTERACTION_TIMEOUT_STATE,
  ClientInteractionTimeoutStatePayload
>;

async function waitForGameView(
  socket: ClientSocket,
  predicate: (view: GameView) => boolean,
): Promise<GameView> {
  const delivery = await waitFor<ClientStateDelivery>(
    socket,
    "client:state",
    value => predicate(value.envelope.payload),
  );
  return delivery.envelope.payload;
}

describe("C4.5 abort current game and return to lobby", () => {
  let server: ReturnType<typeof createTimedGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    commandSequence = 0;
    server = createTimedGameServer();
    await new Promise<void>(resolve => server.httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    server.stopInteractionTimeouts();
    await new Promise<void>(resolve => server.io.close(() => resolve()));
  });

  async function connect() {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("preserves membership, clears the timer, is retry-safe, and can start again", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await new Promise<JoinResult>(resolve => {
      host.emit("host:create-room", { name: "房主" }, resolve);
    });

    const sessions: JoinResult[] = [hostSession];
    for (let index = 1; index < sockets.length; index += 1) {
      sessions.push(await new Promise<JoinResult>(resolve => {
        sockets[index]!.emit(
          "player:join-room",
          { roomId: hostSession.roomId, name: `玩家${index + 1}` },
          resolve,
        );
      }));
    }

    const originalIds = sessions.map(session => session.playerId);
    const room = server.rooms.get(hostSession.roomId)!;
    const originalSeats = room.players.map(player => player.seat);

    const roleViews = sockets.map(socket =>
      waitForGameView(socket, view => view.mode === "role_reveal"),
    );
    expect(await emitAck<BasicResult>(host, "host:start-game")).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);

    for (let index = 0; index < sockets.length; index += 1) {
      expect(await confirmRole(sockets[index]!, dealt[index]!.actionId)).toEqual({ ok: true });
    }

    const wolfIndex = dealt.findIndex(view => view.role === "werewolf");
    expect(wolfIndex).toBeGreaterThanOrEqual(0);
    const wolf = sockets[wolfIndex]!;
    const timerStarted = waitFor<StableTimeoutStateEvent>(
      wolf,
      "client:event",
      event => event.type === CLIENT_INTERACTION_TIMEOUT_STATE && event.payload.active,
    );
    expect(await emitAck<BasicResult>(host, "host:start-night")).toEqual({ ok: true });
    const activeTimeout = await timerStarted;
    expect(activeTimeout.payload.active).toBe(true);
    expect(server.interactionTimeouts.get(room.id)).toBeDefined();

    expect(await emitAck<BasicResult>(sockets[1]!, "host:abort-to-lobby")).toEqual({
      ok: false,
      message: "只有房主可以中断当前游戏",
    });

    const lobbyStates = sockets.map(socket =>
      waitFor<RoomState>(
        socket,
        "room:state",
        state => state.roomId === room.id && state.game.phase === "lobby",
      ),
    );
    const timeoutCleared = waitFor<StableTimeoutStateEvent>(
      wolf,
      "client:event",
      event =>
        event.type === CLIENT_INTERACTION_TIMEOUT_STATE &&
        !event.payload.active &&
        event.payload.actionId === activeTimeout.payload.actionId,
    );

    const abortCommandId = "same-abort-command";
    const firstAbort = await new Promise<BasicResult>(resolve => {
      host.emit("host:abort-to-lobby", { commandId: abortCommandId }, resolve);
    });
    expect(firstAbort).toEqual({ ok: true });

    const lobbyViews = await Promise.all(lobbyStates);
    expect((await timeoutCleared).payload).toEqual({
      roomId: room.id,
      active: false,
      actionId: activeTimeout.payload.actionId,
    });

    expect(room.game).toBeUndefined();
    expect(server.interactionTimeouts.get(room.id)).toBeUndefined();
    expect(room.players.map(player => player.id)).toEqual(originalIds);
    expect(room.players.map(player => player.seat)).toEqual(originalSeats);
    expect(room.players[0]?.isHost).toBe(true);
    expect(room.players.every(player => player.connected)).toBe(true);

    for (const state of lobbyViews) {
      expect(state.players.map(player => player.id)).toEqual(originalIds);
      expect(state.game.canStart).toBe(true);
    }
    expect(lobbyViews[0]?.roleCatalog?.length).toBeGreaterThan(0);
    expect(lobbyViews[0]?.defaultRoleDeck).toHaveLength(5);

    const replayedAbort = await new Promise<BasicResult>(resolve => {
      host.emit("host:abort-to-lobby", { commandId: abortCommandId }, resolve);
    });
    expect(replayedAbort).toEqual({ ok: true });
    expect(room.game).toBeUndefined();

    const secondDeal = sockets.map(socket =>
      waitForGameView(socket, view => view.mode === "role_reveal"),
    );
    expect(await emitAck<BasicResult>(host, "host:start-game")).toEqual({ ok: true });
    await Promise.all(secondDeal);
    expect(room.game?.phase).toBe("role_reveal");
    expect(room.players.map(player => player.id)).toEqual(originalIds);
  });
});