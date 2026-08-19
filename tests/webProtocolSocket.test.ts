import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_EFFECT_VIBRATE } from "../src/protocol/client/ClientEffects.js";
import {
  createClientCommandEnvelope,
  type ClientRealtimeEventEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { createTimedGameServer } from "../src/timedServer.js";

const TIMEOUT_MS = 3000;

type JoinResult = { ok: true; roomId: string; playerId: string };
type GameView = {
  mode: string;
  role: "werewolf" | "witch" | "seer" | "guard" | "hunter" | "villager";
  actionId: string;
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

function protocolCommand(
  socket: ClientSocket,
  type: string,
  payload: object,
  commandId: string,
): Promise<{ ok: boolean; message?: string }> {
  return emitAck(
    socket,
    "client:command",
    createClientCommandEnvelope(type, payload, commandId),
  );
}

describe("E2 Web protocol over Socket.IO", () => {
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

  async function connect() {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("runs migrated post-start commands through client:command, delivers stable effects, and dedupes retries", async () => {
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
      waitFor<GameView>(socket, "player:game-state", view => view.mode === "role_reveal"),
    );
    expect(
      await emitAck<{ ok: boolean }>(host, "host:start-game", {
        commandId: "legacy-start-for-e2",
      }),
    ).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);

    let finalEnvelope: ReturnType<typeof createClientCommandEnvelope> | undefined;
    for (let index = 0; index < sockets.length; index += 1) {
      const envelope = createClientCommandEnvelope(
        "werewolf.confirmRole",
        { actionId: dealt[index]!.actionId },
        `protocol-confirm-${index}`,
      );
      if (index === sockets.length - 1) finalEnvelope = envelope;
      expect(await emitAck(sockets[index]!, "client:command", envelope)).toEqual({ ok: true });
    }

    const room = game.rooms.get(hostSession.roomId)!;
    expect(room.game?.phase).toBe("night_start");
    const actionIdAfterFirstDelivery = room.game?.actionId;

    let replayBroadcasts = 0;
    const countReplay = () => { replayBroadcasts += 1; };
    host.on("room:state", countReplay);
    expect(
      await emitAck(sockets.at(-1)!, "client:command", finalEnvelope!),
    ).toEqual({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 25));
    host.off("room:state", countReplay);

    expect(replayBroadcasts).toBe(0);
    expect(room.game?.phase).toBe("night_start");
    expect(room.game?.actionId).toBe(actionIdAfterFirstDelivery);

    const wolfIndex = dealt.findIndex(view => view.role === "werewolf");
    expect(wolfIndex).toBeGreaterThanOrEqual(0);
    const wolfSocket = sockets[wolfIndex]!;
    const wolfAction = waitFor<GameView>(
      wolfSocket,
      "player:game-state",
      view => view.mode === "wolf_action",
    );
    const actionEffect = waitFor<ClientRealtimeEventEnvelope>(
      wolfSocket,
      "client:event",
      event => event.type === CLIENT_EFFECT_VIBRATE,
    );

    expect(await protocolCommand(host, "werewolf.startNight", {}, "protocol-start-night")).toEqual({ ok: true });
    expect((await wolfAction).mode).toBe("wolf_action");
    expect(await actionEffect).toMatchObject({
      kind: "event",
      type: CLIENT_EFFECT_VIBRATE,
      payload: {
        pattern: [300, 150, 300],
        reason: "action-alert",
        context: { phase: "night_werewolf" },
      },
    });
  });
});
