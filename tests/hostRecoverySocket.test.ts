import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_EFFECT_VIBRATE,
  type ClientVibrateEffectPayload,
} from "../src/protocol/client/ClientEffects.js";
import {
  createClientCommandEnvelope,
  type ClientRealtimeEventEnvelope,
  type ClientStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { attachSocketIoClientProtocolTransport } from "../src/runtime/node/SocketIoClientProtocolTransport.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;
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

function emitAck<T>(socket: ClientSocket, event: string, payload: Record<string, unknown> = {}): Promise<T> {
  const commandPayload = {
    commandId: `c4-command-${generatedCommandId++}`,
    ...payload,
  };
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, commandPayload, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function sendGameCommand(
  socket: ClientSocket,
  type: "werewolf.startGame" | "werewolf.confirmRole" | "werewolf.startNight",
  payload: Record<string, unknown>,
  commandPrefix: string,
): Promise<BasicResult> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(
      "client:command",
      createClientCommandEnvelope(
        type,
        payload,
        `${commandPrefix}-${generatedCommandId++}`,
      ),
      (error: Error | null, result: BasicResult) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

function startGame(socket: ClientSocket): Promise<BasicResult> {
  return sendGameCommand(socket, "werewolf.startGame", {}, "c4-start-game");
}

function confirmRole(socket: ClientSocket, actionId: string): Promise<BasicResult> {
  return sendGameCommand(socket, "werewolf.confirmRole", { actionId }, "c4-confirm");
}

function startNight(socket: ClientSocket): Promise<BasicResult> {
  return sendGameCommand(socket, "werewolf.startNight", {}, "c4-start-night");
}

type JoinResult = { ok: true; roomId: string; playerId: string };
type BasicResult = { ok: boolean; message?: string };
type GameView = {
  mode: string;
  role: "werewolf" | "witch" | "seer" | "villager";
  actionId: string;
};
type ClientStateDelivery = {
  revision: number;
  envelope: ClientStateEnvelope<GameView>;
};
type ActionAlertEffect = ClientRealtimeEventEnvelope<
  typeof CLIENT_EFFECT_VIBRATE,
  ClientVibrateEffectPayload
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

describe("C4.1 Socket.IO host recovery reminder", () => {
  let game: ReturnType<typeof createGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    generatedCommandId = 0;
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

  it("allows only the host and dedupes a repeated recovery delivery", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await new Promise<JoinResult>(resolve => {
      host.emit("host:create-room", { name: "房主" }, resolve);
    });

    for (let index = 1; index < sockets.length; index += 1) {
      await new Promise<JoinResult>(resolve => {
        sockets[index]!.emit(
          "player:join-room",
          { roomId: hostSession.roomId, name: `玩家${index + 1}` },
          resolve,
        );
      });
    }

    const roleViews = sockets.map(socket =>
      waitForGameView(socket, view => view.mode === "role_reveal"),
    );
    expect(await startGame(host)).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);

    for (let index = 0; index < sockets.length; index += 1) {
      expect(await confirmRole(sockets[index]!, dealt[index]!.actionId)).toEqual({ ok: true });
    }

    const wolfIndex = dealt.findIndex(view => view.role === "werewolf");
    expect(wolfIndex).toBeGreaterThanOrEqual(0);
    const wolf = sockets[wolfIndex]!;
    const wolfAction = waitForGameView(wolf, view => view.mode === "wolf_action");
    expect(await startNight(host)).toEqual({ ok: true });
    await wolfAction;
    await new Promise(resolve => setTimeout(resolve, 25));

    const nonHost = sockets[1]!;
    expect(
      await emitAck<BasicResult>(nonHost, "host:resend-current-action", {
        commandId: "non-host-recovery",
      }),
    ).toEqual({ ok: false, message: "只有房主可以重新提醒当前行动" });

    const missingCommandId = await new Promise<BasicResult>(resolve => {
      host.emit("host:resend-current-action", {}, resolve);
    });
    expect(missingCommandId).toEqual({
      ok: false,
      message: "缺少有效的 commandId，请重试",
    });

    const room = game.rooms.get(hostSession.roomId)!;
    const gameBefore = JSON.stringify(room.game);
    const alerts: ActionAlertEffect[] = [];
    const collectAlert = (event: ActionAlertEffect) => {
      if (
        event.type === CLIENT_EFFECT_VIBRATE &&
        event.payload.reason === "action-alert" &&
        event.payload.context?.["resumed"] === true
      ) {
        alerts.push(event);
      }
    };
    wolf.on("client:event", collectAlert);

    expect(
      await emitAck<BasicResult>(host, "host:resend-current-action", {
        commandId: "same-recovery-command",
      }),
    ).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(
      await emitAck<BasicResult>(host, "host:resend-current-action", {
        commandId: "same-recovery-command",
      }),
    ).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "event",
      type: CLIENT_EFFECT_VIBRATE,
      payload: {
        pattern: [300, 150, 300],
        reason: "action-alert",
        context: {
          actionId: room.game?.actionId,
          phase: room.game?.phase,
          resumed: true,
        },
      },
    });
    expect(JSON.stringify(room.game)).toBe(gameBefore);

    expect(
      await emitAck<BasicResult>(host, "host:resend-current-action", {
        commandId: "new-recovery-command",
      }),
    ).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(alerts).toHaveLength(2);
    expect(JSON.stringify(room.game)).toBe(gameBefore);
    wolf.off("client:event", collectAlert);
  });
});
