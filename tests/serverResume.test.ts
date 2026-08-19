import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_SESSION_REPLACED,
  type ClientSessionReplacedPayload,
} from "../src/protocol/client/ClientSessionEvents.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientRealtimeEventEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type AckSuccess = {
  ok: true;
  roomId: string;
  playerId: string;
  seat: number;
  name?: string;
  resumeToken?: string;
  isHost?: boolean;
};

type AckFailure = { ok: false; message: string };

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

describe("server session resume", () => {
  let game: ReturnType<typeof createGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    game = createGameServer();
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

  async function createRoomWithPlayer() {
    const host = await connect();
    const player = await connect();
    const hostSession = await emitAck<AckSuccess>(host, "host:create-room", { name: "房主" });
    const playerSession = await emitAck<AckSuccess>(player, "player:join-room", {
      roomId: hostSession.roomId,
      name: "玩家二号",
    });
    return { host, player, hostSession, playerSession };
  }

  it("issues private resume tokens without exposing them in room state", async () => {
    const { host, hostSession, playerSession } = await createRoomWithPlayer();
    expect(hostSession.resumeToken).toBeTruthy();
    expect(playerSession.resumeToken).toBeTruthy();

    const statePromise = waitFor<Record<string, unknown>>(host, "room:state");
    const third = await connect();
    await emitAck(third, "player:join-room", { roomId: hostSession.roomId, name: "玩家三号" });
    const state = await statePromise;
    expect(JSON.stringify(state)).not.toContain("resumeToken");
  });

  it("restores the player at the host-assigned seat with the pending private prompt", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    expect(await emitAck<AckSuccess | AckFailure>(host, "host:move-player-seat", {
      targetPlayerId: playerSession.playerId,
      insertIndex: 0,
    })).toEqual({ ok: true });
    const promptPromise = waitFor<{ promptId: string }>(player, "player:test-prompt");
    await emitAck(host, "host:send-test-prompt", { targetPlayerId: playerSession.playerId });
    const prompt = await promptPromise;

    const offlineState = waitFor<{ players: Array<{ id: string; connected: boolean }> }>(
      host,
      "room:state",
      state => state.players.some(item => item.id === playerSession.playerId && !item.connected),
    );
    player.disconnect();
    await offlineState;

    const resumedPlayer = await connect();
    const privateState = waitFor<{ promptId: string; status: string }>(
      resumedPlayer,
      "player:test-prompt-state",
    );
    const resumedPrompt = waitFor<{ promptId: string; resumed: boolean }>(
      resumedPlayer,
      "player:test-prompt",
      payload => payload.resumed === true,
    );
    const resumed = await emitAck<AckSuccess>(resumedPlayer, "player:resume", {
      roomId: hostSession.roomId,
      playerId: playerSession.playerId,
      resumeToken: playerSession.resumeToken,
    });

    expect(resumed).toMatchObject({
      ok: true,
      playerId: playerSession.playerId,
      seat: 1,
      name: "玩家二号",
      isHost: false,
    });
    expect(await privateState).toMatchObject({ promptId: prompt.promptId, status: "sent" });
    expect(await resumedPrompt).toMatchObject({ promptId: prompt.promptId, resumed: true });

    const room = game.rooms.get(hostSession.roomId);
    expect(room?.players).toHaveLength(2);
    expect(room?.players.find(item => item.id === playerSession.playerId)).toMatchObject({
      seat: 1,
      connected: true,
    });
  });

  it("continues an acknowledged prompt after restoring the player", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const promptPromise = waitFor<{ promptId: string }>(player, "player:test-prompt");
    await emitAck(host, "host:send-test-prompt", { targetPlayerId: playerSession.playerId });
    const prompt = await promptPromise;
    const acknowledged = await emitAck<AckSuccess | AckFailure>(player, "player:ack-test-prompt", {
      promptId: prompt.promptId,
    });
    expect(acknowledged.ok).toBe(true);
    player.disconnect();

    const resumedPlayer = await connect();
    const privateState = waitFor<{ promptId: string; status: string }>(
      resumedPlayer,
      "player:test-prompt-state",
    );
    await emitAck<AckSuccess>(resumedPlayer, "player:resume", {
      roomId: hostSession.roomId,
      playerId: playerSession.playerId,
      resumeToken: playerSession.resumeToken,
    });
    expect(await privateState).toMatchObject({ promptId: prompt.promptId, status: "acknowledged" });

    const submitted = await emitAck<AckSuccess | AckFailure>(
      resumedPlayer,
      "player:submit-test-choice",
      { promptId: prompt.promptId, choice: "选项一" },
    );
    expect(submitted.ok).toBe(true);
    expect(game.rooms.get(hostSession.roomId)?.activePrompt).toMatchObject({
      id: prompt.promptId,
      status: "submitted",
      choice: "选项一",
    });
  });

  it("rejects invalid credentials", async () => {
    const { hostSession, playerSession } = await createRoomWithPlayer();
    const attacker = await connect();
    const result = await emitAck<AckFailure>(attacker, "player:resume", {
      roomId: hostSession.roomId,
      playerId: playerSession.playerId,
      resumeToken: "wrong-token",
    });

    expect(result).toEqual({ ok: false, message: "恢复凭证无效" });
  });

  it("delivers the stable replacement event before disconnecting the old connection", async () => {
    const { host, player, hostSession, playerSession } = await createRoomWithPlayer();
    const stableReplaced = waitFor<
      ClientRealtimeEventEnvelope<typeof CLIENT_SESSION_REPLACED, ClientSessionReplacedPayload>
    >(
      player,
      "client:event",
      event => event.type === CLIENT_SESSION_REPLACED,
    );
    const replacement = await connect();
    const resumed = await emitAck<AckSuccess>(replacement, "player:resume", {
      roomId: hostSession.roomId,
      playerId: playerSession.playerId,
      resumeToken: playerSession.resumeToken,
    });

    expect(resumed.ok).toBe(true);
    expect(await stableReplaced).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event",
      type: CLIENT_SESSION_REPLACED,
      payload: {
        roomId: hostSession.roomId,
        playerId: playerSession.playerId,
      },
    });
    await new Promise(resolve => setTimeout(resolve, 20));

    const room = game.rooms.get(hostSession.roomId);
    const storedPlayer = room?.players.find(item => item.id === playerSession.playerId);
    expect(player.connected).toBe(false);
    expect(storedPlayer).toMatchObject({ connected: true, socketId: replacement.id });

    const promptPromise = waitFor(replacement, "player:test-prompt");
    const result = await emitAck<AckSuccess | AckFailure>(host, "host:send-test-prompt", {
      targetPlayerId: playerSession.playerId,
    });
    expect(result.ok).toBe(true);
    await promptPromise;
  });

  it("restores a host with host permissions", async () => {
    const host = await connect();
    const hostSession = await emitAck<AckSuccess>(host, "host:create-room", { name: "房主" });
    host.disconnect();

    const restoredHost = await connect();
    const result = await emitAck<AckSuccess>(restoredHost, "player:resume", {
      roomId: hostSession.roomId,
      playerId: hostSession.playerId,
      resumeToken: hostSession.resumeToken,
    });

    expect(result).toMatchObject({ ok: true, isHost: true, seat: 1 });
  });
});
