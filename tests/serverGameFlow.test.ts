import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createClientCommandEnvelope,
  type ClientStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { attachSocketIoClientProtocolTransport } from "../src/runtime/node/SocketIoClientProtocolTransport.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;
const IDEMPOTENT_SOCKET_EVENTS = new Set([
  "player:submit-hunter-execution",
  "player:submit-vote",
  "host:close-voting",
  "host:begin-night-start",
]);
let generatedCommandId = 0;

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
  const commandPayload = IDEMPOTENT_SOCKET_EVENTS.has(event) && payload && typeof payload === "object"
    ? { commandId: `test-command-${generatedCommandId++}`, ...(payload as Record<string, unknown>) }
    : payload;
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, commandPayload, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

type StableGameCommand =
  | "werewolf.confirmRole"
  | "werewolf.submitWolfTarget"
  | "werewolf.submitWitchAction"
  | "werewolf.submitSeerTarget"
  | "werewolf.confirmSeerResult"
  | "werewolf.startNight";

type StableLifecycleCommand = "werewolf.startGame" | "werewolf.restartGame";

function sendGameCommand(
  socket: ClientSocket,
  type: StableGameCommand,
  payload: Record<string, unknown>,
  commandPrefix: string,
): Promise<{ ok: boolean; message?: string }> {
  return emitAck(
    socket,
    "client:command",
    createClientCommandEnvelope(
      type,
      payload,
      `${commandPrefix}-${generatedCommandId++}`,
    ),
  );
}

function sendLifecycleCommand(
  socket: ClientSocket,
  type: StableLifecycleCommand,
  payload: Record<string, unknown>,
  commandId: string,
): Promise<{ ok: boolean; message?: string }> {
  return emitAck(
    socket,
    "client:command",
    createClientCommandEnvelope(type, payload, commandId),
  );
}

function startGame(
  socket: ClientSocket,
  commandId = `protocol-start-game-${generatedCommandId++}`,
): Promise<{ ok: boolean; message?: string }> {
  return sendLifecycleCommand(socket, "werewolf.startGame", {}, commandId);
}

function restartGame(
  socket: ClientSocket,
  commandId = `protocol-restart-game-${generatedCommandId++}`,
): Promise<{ ok: boolean; message?: string }> {
  return sendLifecycleCommand(socket, "werewolf.restartGame", {}, commandId);
}

function confirmRole(
  socket: ClientSocket,
  actionId: string,
  commandId = `protocol-confirm-${generatedCommandId++}`,
): Promise<{ ok: boolean; message?: string }> {
  return emitAck(
    socket,
    "client:command",
    createClientCommandEnvelope("werewolf.confirmRole", { actionId }, commandId),
  );
}

function submitSeerTarget(
  socket: ClientSocket,
  actionId: string,
  targetPlayerId: string,
): Promise<{ ok: boolean; message?: string }> {
  return sendGameCommand(
    socket,
    "werewolf.submitSeerTarget",
    { actionId, targetPlayerId },
    "protocol-seer-target",
  );
}

function startNight(socket: ClientSocket): Promise<{ ok: boolean; message?: string }> {
  return sendGameCommand(socket, "werewolf.startNight", {}, "protocol-start-night");
}

function submitWolfTarget(
  socket: ClientSocket,
  actionId: string,
  targetPlayerId: string,
): Promise<{ ok: boolean; message?: string }> {
  return sendGameCommand(
    socket,
    "werewolf.submitWolfTarget",
    { actionId, targetPlayerId },
    "protocol-wolf-target",
  );
}

function submitWitchAction(
  socket: ClientSocket,
  actionId: string,
): Promise<{ ok: boolean; message?: string }> {
  return sendGameCommand(
    socket,
    "werewolf.submitWitchAction",
    { actionId, useAntidote: false, poisonTargetId: null },
    "protocol-witch-action",
  );
}

function confirmSeerResult(
  socket: ClientSocket,
  actionId: string,
): Promise<{ ok: boolean; message?: string }> {
  return sendGameCommand(
    socket,
    "werewolf.confirmSeerResult",
    { actionId },
    "protocol-seer-result",
  );
}

type JoinResult = { ok: true; roomId: string; playerId: string };
type GameView = {
  mode: string;
  role: "werewolf" | "witch" | "seer" | "villager";
  actionId: string;
  targets?: Array<{ id: string; name?: string; seat?: number }>;
  poisonTargets?: Array<{ id: string; name?: string; seat?: number }>;
  checkedAlignment?: string;
  deaths?: Array<{ id: string; name?: string; seat?: number }>;
};
type ClientStateDelivery = {
  revision: number;
  envelope: ClientStateEnvelope<GameView>;
};

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

describe("five-player Socket.IO game flow", () => {
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

  it("deals private roles and completes the first night in strict order", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await emitAck<JoinResult>(host, "host:create-room", { name: "房主" });
    const sessions = [hostSession];
    for (let index = 1; index < sockets.length; index += 1) {
      sessions.push(
        await emitAck<JoinResult>(sockets[index]!, "player:join-room", {
          roomId: hostSession.roomId,
          name: `玩家${index + 1}`,
        }),
      );
    }

    const roleViews = sockets.map(socket =>
      waitForGameView(socket, view => view.mode === "role_reveal"),
    );
    const publicState = waitFor<Record<string, unknown>>(
      host,
      "room:state",
      state => JSON.stringify(state).includes("role_reveal"),
    );
    expect(await startGame(host)).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);
    expect(JSON.stringify(await publicState)).not.toMatch(/werewolf|witch|seer|villager/);

    const byRole = new Map(dealt.map((view, index) => [view.role, { view, socket: sockets[index]!, session: sessions[index]! }]));
    expect(dealt.map(view => view.role).sort()).toEqual(
      ["seer", "villager", "villager", "werewolf", "witch"].sort(),
    );

    const wolf = byRole.get("werewolf")!;
    for (let index = 0; index < sockets.length; index += 1) {
      expect(await confirmRole(sockets[index]!, dealt[index]!.actionId)).toEqual({ ok: true });
    }

    const wolfAction = waitForGameView(wolf.socket, view => view.mode === "wolf_action");
    expect(await startNight(host)).toEqual({ ok: true });

    const wolfView = await wolfAction;
    const victim = wolfView.targets![0]!;
    expect(victim.name).toBeTypeOf("string");
    expect(victim.seat).toBeTypeOf("number");
    expect(victim).not.toHaveProperty("connected");
    expect(victim).not.toHaveProperty("socketId");
    expect(victim).not.toHaveProperty("isHost");
    const victimId = victim.id;
    const witch = byRole.get("witch")!;
    const witchAction = waitForGameView(witch.socket, view => view.mode === "witch_action");
    expect(await submitWolfTarget(wolf.socket, wolfView.actionId, victimId)).toEqual({ ok: true });

    const witchView = await witchAction;
    const seer = byRole.get("seer")!;
    const seerAction = waitForGameView(seer.socket, view => view.mode === "seer_action");
    expect(await submitWitchAction(witch.socket, witchView.actionId)).toEqual({ ok: true });

    const seerView = await seerAction;
    const seerResult = waitForGameView(seer.socket, view => view.mode === "seer_result");
    expect(
      await submitSeerTarget(seer.socket, seerView.actionId, wolf.session.playerId),
    ).toEqual({ ok: true });
    const resultView = await seerResult;
    expect(resultView.checkedAlignment).toBe("werewolf");

    const completed = sockets.map(socket =>
      waitForGameView(socket, view =>
        view.mode === "day_vote" || view.mode === "spectator" || view.mode === "game_over"),
    );
    expect(await confirmSeerResult(seer.socket, resultView.actionId)).toEqual({ ok: true });
    const finalViews = await Promise.all(completed);
    for (const view of finalViews) {
      if (view.deaths) expect(view.deaths.map((player: { id: string }) => player.id)).toContain(victimId);
    }
  });

  it("dedupes stable role-confirm retries by actor without replaying the transition", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await emitAck<JoinResult>(host, "host:create-room", { name: "房主" });
    for (let index = 1; index < sockets.length; index += 1) {
      await emitAck<JoinResult>(sockets[index]!, "player:join-room", {
        roomId: hostSession.roomId,
        name: `玩家${index + 1}`,
      });
    }

    const roleViews = sockets.map(socket =>
      waitForGameView(socket, view => view.mode === "role_reveal"),
    );
    expect(await startGame(host)).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);
    const commandId = "shared-retry-id";

    expect(await confirmRole(sockets[0]!, dealt[0]!.actionId, commandId)).toEqual({ ok: true });
    expect(await confirmRole(sockets[1]!, dealt[1]!.actionId, commandId)).toEqual({ ok: true });

    const room = game.rooms.get(hostSession.roomId)!;
    expect(room.game?.confirmedRolePlayerIds).toHaveLength(2);

    for (let index = 2; index < sockets.length - 1; index += 1) {
      expect(await confirmRole(sockets[index]!, dealt[index]!.actionId, `confirm-${index}`)).toEqual({ ok: true });
    }
    const reachedNightStart = waitFor<{ game: { phase: string } }>(
      host,
      "room:state",
      state => state.game.phase === "night_start",
    );
    expect(await confirmRole(sockets[4]!, dealt[4]!.actionId, "confirm-4")).toEqual({ ok: true });
    await reachedNightStart;
    const actionIdAfterFirstDelivery = room.game?.actionId;
    expect(room.game?.phase).toBe("night_start");

    let replayedBroadcasts = 0;
    const countReplayBroadcast = () => { replayedBroadcasts += 1; };
    host.on("room:state", countReplayBroadcast);
    expect(await confirmRole(sockets[4]!, dealt[4]!.actionId, "confirm-4")).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));
    host.off("room:state", countReplayBroadcast);
    expect(replayedBroadcasts).toBe(0);
    expect(room.game?.phase).toBe("night_start");
    expect(room.game?.actionId).toBe(actionIdAfterFirstDelivery);
  });

  it("dedupes host start/restart lifecycle retries without recreating game state", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await emitAck<JoinResult>(host, "host:create-room", { name: "房主" });
    for (let index = 1; index < sockets.length; index += 1) {
      await emitAck<JoinResult>(sockets[index]!, "player:join-room", {
        roomId: hostSession.roomId,
        name: `玩家${index + 1}`,
      });
    }

    expect(await startGame(host, "start-game-retry")).toEqual({ ok: true });

    const room = game.rooms.get(hostSession.roomId)!;
    const firstStartActionId = room.game?.actionId;
    const firstStartRoles = JSON.stringify(room.game?.roles);

    let startReplayBroadcasts = 0;
    const countStartReplayBroadcast = () => { startReplayBroadcasts += 1; };
    host.on("room:state", countStartReplayBroadcast);
    expect(await startGame(host, "start-game-retry")).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));
    host.off("room:state", countStartReplayBroadcast);

    expect(startReplayBroadcasts).toBe(0);
    expect(room.game?.actionId).toBe(firstStartActionId);
    expect(JSON.stringify(room.game?.roles)).toBe(firstStartRoles);

    expect(await restartGame(host, "restart-game-retry")).toEqual({ ok: true });
    const firstRestartActionId = room.game?.actionId;
    const firstRestartRoles = JSON.stringify(room.game?.roles);

    let restartReplayBroadcasts = 0;
    const countRestartReplayBroadcast = () => { restartReplayBroadcasts += 1; };
    host.on("room:state", countRestartReplayBroadcast);
    expect(await restartGame(host, "restart-game-retry")).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));
    host.off("room:state", countRestartReplayBroadcast);

    expect(restartReplayBroadcasts).toBe(0);
    expect(room.game?.actionId).toBe(firstRestartActionId);
    expect(JSON.stringify(room.game?.roles)).toBe(firstRestartRoles);
    expect(room.commandReceipts).toEqual([
      { commandId: "host:restart-game-retry", result: { kind: "broadcast" } },
    ]);
  });
});
