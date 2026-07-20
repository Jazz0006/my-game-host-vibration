import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

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

type JoinResult = { ok: true; roomId: string; playerId: string };
type GameView = {
  mode: string;
  role: "werewolf" | "witch" | "seer" | "villager";
  actionId: string;
  targets?: Array<{ id: string }>;
  poisonTargets?: Array<{ id: string }>;
  checkedAlignment?: string;
  deaths?: Array<{ id: string }>;
};

describe("five-player Socket.IO game flow", () => {
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
      waitFor<GameView>(socket, "player:game-state", view => view.mode === "role_reveal"),
    );
    const publicState = waitFor<Record<string, unknown>>(
      host,
      "room:state",
      state => JSON.stringify(state).includes("role_reveal"),
    );
    expect(await emitAck<{ ok: boolean }>(host, "host:start-game", {})).toEqual({ ok: true });
    const dealt = await Promise.all(roleViews);
    expect(JSON.stringify(await publicState)).not.toMatch(/werewolf|witch|seer|villager/);

    const byRole = new Map(dealt.map((view, index) => [view.role, { view, socket: sockets[index]!, session: sessions[index]! }]));
    expect(dealt.map(view => view.role).sort()).toEqual(
      ["seer", "villager", "villager", "werewolf", "witch"].sort(),
    );

    const wolf = byRole.get("werewolf")!;
    const wolfAction = waitFor<GameView>(wolf.socket, "player:game-state", view => view.mode === "wolf_action");
    for (let index = 0; index < sockets.length; index += 1) {
      const result = await emitAck<{ ok: boolean }>(sockets[index]!, "player:confirm-role", {
        actionId: dealt[index]!.actionId,
      });
      expect(result.ok).toBe(true);
    }

    const wolfView = await wolfAction;
    const victimId = wolfView.targets![0]!.id;
    const witch = byRole.get("witch")!;
    const witchAction = waitFor<GameView>(witch.socket, "player:game-state", view => view.mode === "witch_action");
    expect(
      await emitAck<{ ok: boolean }>(wolf.socket, "player:submit-wolf-target", {
        actionId: wolfView.actionId,
        targetPlayerId: victimId,
      }),
    ).toEqual({ ok: true });

    const witchView = await witchAction;
    const seer = byRole.get("seer")!;
    const seerAction = waitFor<GameView>(seer.socket, "player:game-state", view => view.mode === "seer_action");
    expect(
      await emitAck<{ ok: boolean }>(witch.socket, "player:submit-witch-action", {
        actionId: witchView.actionId,
        useAntidote: false,
        poisonTargetId: null,
      }),
    ).toEqual({ ok: true });

    const seerView = await seerAction;
    const seerResult = waitFor<GameView>(seer.socket, "player:game-state", view => view.mode === "seer_result");
    await emitAck(seer.socket, "player:submit-seer-target", {
      actionId: seerView.actionId,
      targetPlayerId: wolf.session.playerId,
    });
    const resultView = await seerResult;
    expect(resultView.checkedAlignment).toBe("werewolf");

    const completed = sockets.map(socket =>
      waitFor<GameView>(socket, "player:game-state", view => view.mode === "night_complete"),
    );
    await emitAck(seer.socket, "player:confirm-seer-result", { actionId: resultView.actionId });
    const finalViews = await Promise.all(completed);
    for (const view of finalViews) expect(view.deaths?.map(player => player.id)).toEqual([victimId]);
  });
});
