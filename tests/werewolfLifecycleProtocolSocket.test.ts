import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { attachSocketIoClientProtocolTransport } from "../src/runtime/node/SocketIoClientProtocolTransport.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type JoinResult = { ok: true; roomId: string; playerId: string };

function waitFor(socket: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), TIMEOUT_MS);
    socket.once(event, value => {
      clearTimeout(timer);
      resolve(value);
    });
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

describe("stable Werewolf lifecycle client protocol", () => {
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

  async function connect(): Promise<ClientSocket> {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("starts and restarts through client:command with lifecycle idempotency", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await emitAck<JoinResult>(host, "host:create-room", { name: "房主" });
    for (let index = 1; index < sockets.length; index += 1) {
      await emitAck<JoinResult>(sockets[index]!, "player:join-room", {
        roomId: hostSession.roomId,
        name: `玩家${index + 1}`,
      });
    }

    expect(
      await emitAck(host, "client:command", createClientCommandEnvelope(
        "werewolf.startGame",
        {},
        "stable-start",
      )),
    ).toEqual({ ok: true });

    const room = game.rooms.get(hostSession.roomId)!;
    expect(room.game).toBeDefined();
    const firstStartActionId = room.game?.actionId;
    const firstRoles = JSON.stringify(room.game?.roles);

    expect(
      await emitAck(host, "client:command", createClientCommandEnvelope(
        "werewolf.startGame",
        {},
        "stable-start",
      )),
    ).toEqual({ ok: true });
    expect(room.game?.actionId).toBe(firstStartActionId);
    expect(JSON.stringify(room.game?.roles)).toBe(firstRoles);

    expect(
      await emitAck(host, "client:command", createClientCommandEnvelope(
        "werewolf.restartGame",
        {},
        "stable-restart",
      )),
    ).toEqual({ ok: true });
    const restartActionId = room.game?.actionId;
    const restartRoles = JSON.stringify(room.game?.roles);

    expect(
      await emitAck(host, "client:command", createClientCommandEnvelope(
        "werewolf.restartGame",
        {},
        "stable-restart",
      )),
    ).toEqual({ ok: true });
    expect(room.game?.actionId).toBe(restartActionId);
    expect(JSON.stringify(room.game?.roles)).toBe(restartRoles);
    expect(room.commandReceipts).toEqual([
      { commandId: "host:stable-restart", result: { kind: "broadcast" } },
    ]);
  });
});
