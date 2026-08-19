import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_EFFECT_VIBRATE,
  type ClientVibrateEffectPayload,
} from "../src/protocol/client/ClientEffects.js";
import type { ClientRealtimeEventEnvelope } from "../src/protocol/client/ClientProtocol.js";
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
      { commandId: `timeout-command-${commandSequence++}`, ...payload },
      (error: Error | null, result: T) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

type JoinResult = {
  ok: true;
  roomId: string;
  playerId: string;
  resumeToken: string;
};
type BasicResult = { ok: boolean; message?: string };
type GameView = {
  mode: string;
  role: "werewolf" | "witch" | "seer" | "villager";
  actionId: string;
};
type TimeoutState = {
  active: boolean;
  actionId: string;
  deadlineAt: number;
  warning?: boolean;
  canExtend: boolean;
};
type ActionAlertEffect = ClientRealtimeEventEnvelope<
  typeof CLIENT_EFFECT_VIBRATE,
  ClientVibrateEffectPayload
>;
type ExtensionResult = {
  ok: boolean;
  message?: string;
  deadlineAt?: number;
  canExtend?: boolean;
};

describe("C4.4 Socket.IO interaction timeout", () => {
  let game: ReturnType<typeof createTimedGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    commandSequence = 0;
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

  async function connect() {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("warns, survives resume, permits one extension, and safely times out the current action", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const sessions: JoinResult[] = [];
    const hostSession = await new Promise<JoinResult>(resolve => {
      host.emit("host:create-room", { name: "房主" }, resolve);
    });
    sessions.push(hostSession);

    for (let index = 1; index < sockets.length; index += 1) {
      const session = await new Promise<JoinResult>(resolve => {
        sockets[index]!.emit(
          "player:join-room",
          { roomId: hostSession.roomId, name: `玩家${index + 1}` },
          resolve,
        );
      });
      sessions.push(session);
    }

    const configResult = await new Promise<{ ok: boolean; timeoutSeconds?: number }>(resolve => {
      host.emit("host:set-interaction-timeout", { timeoutSeconds: 15 }, resolve);
    });
    expect(configResult).toEqual({ ok: true, timeoutSeconds: 15 });

    const roleViews = sockets.map(socket =>
      waitFor<GameView>(socket, "player:game-state", view => view.mode === "role_reveal"),
    );
    expect(await emitAck<BasicResult>(host, "host:start-game")).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);

    for (let index = 0; index < sockets.length; index += 1) {
      expect(
        await emitAck<BasicResult>(sockets[index]!, "player:confirm-role", {
          actionId: dealt[index]!.actionId,
        }),
      ).toEqual({ ok: true });
    }

    const wolfIndex = dealt.findIndex(view => view.role === "werewolf");
    expect(wolfIndex).toBeGreaterThanOrEqual(0);
    const wolf = sockets[wolfIndex]!;
    const wolfSession = sessions[wolfIndex]!;
    const timeoutStatePromise = waitFor<TimeoutState>(
      wolf,
      "player:interaction-timeout-state",
      state => state.active,
    );

    expect(await emitAck<BasicResult>(host, "host:start-night")).toEqual({ ok: true });
    const timeoutState = await timeoutStatePromise;
    const room = game.rooms.get(hostSession.roomId)!;
    expect(room.game?.phase).toBe("night_werewolf");
    expect(timeoutState.actionId).toBe(room.game?.actionId);
    expect(timeoutState.canExtend).toBe(true);

    const originalDeadline = timeoutState.deadlineAt;
    wolf.disconnect();
    await new Promise(resolve => setTimeout(resolve, 50));

    const resumedWolf = await connect();
    const resumedTimeoutPromise = waitFor<TimeoutState>(
      resumedWolf,
      "player:interaction-timeout-state",
      state => state.active && state.actionId === timeoutState.actionId,
    );
    const resumeResult = await new Promise<BasicResult>(resolve => {
      resumedWolf.emit(
        "player:resume",
        {
          roomId: wolfSession.roomId,
          playerId: wolfSession.playerId,
          resumeToken: wolfSession.resumeToken,
        },
        resolve,
      );
    });
    expect(resumeResult.ok).toBe(true);
    const resumedTimeout = await resumedTimeoutPromise;
    expect(resumedTimeout.deadlineAt).toBe(originalDeadline);
    expect(resumedTimeout.canExtend).toBe(true);

    const timer = game.interactionTimeouts.get(hostSession.roomId)!;
    timer.warningAt = Date.now() - 1;
    const warning = await waitFor<ActionAlertEffect>(
      resumedWolf,
      "client:event",
      event =>
        event.type === CLIENT_EFFECT_VIBRATE &&
        event.payload.reason === "action-alert" &&
        event.payload.context?.["timeoutWarning"] === true,
    );
    expect(warning.payload.pattern).toEqual([300, 150, 300]);
    expect(warning.payload.context?.["actionId"]).toBe(timeoutState.actionId);

    const deadlineBeforeExtension = timer.deadlineAt;
    const commandId = "same-extension-command";
    const firstExtension = await new Promise<ExtensionResult>(resolve => {
      resumedWolf.emit(
        "player:extend-interaction-timeout",
        { commandId, actionId: timeoutState.actionId },
        resolve,
      );
    });
    expect(firstExtension.ok).toBe(true);
    expect(firstExtension.canExtend).toBe(false);
    expect(firstExtension.deadlineAt).toBe(deadlineBeforeExtension + 30_000);

    const replayedExtension = await new Promise<ExtensionResult>(resolve => {
      resumedWolf.emit(
        "player:extend-interaction-timeout",
        { commandId, actionId: timeoutState.actionId },
        resolve,
      );
    });
    expect(replayedExtension).toEqual(firstExtension);

    const extendedTimer = game.interactionTimeouts.get(hostSession.roomId)!;
    extendedTimer.deadlineAt = Date.now() - 1;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + TIMEOUT_MS;
      const poll = () => {
        if (room.game?.phase !== "night_werewolf") return resolve();
        if (Date.now() >= deadline) return reject(new Error("timed interaction did not advance"));
        setTimeout(poll, 25);
      };
      poll();
    });

    expect(room.game?.wolfTargetId).toBeUndefined();
    expect(room.game?.phase).toBe("night_witch");
    expect(room.game?.actionId).not.toBe(timeoutState.actionId);
  });
});
