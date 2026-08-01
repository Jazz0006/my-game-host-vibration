import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameEngineRegistry } from "../src/games/registry.js";
import { GAME_METADATA } from "../src/games/shared/metadata.js";
import type { DouDizhuPlayerView } from "../src/games/doudizhu/state.js";
import { SqliteRoomStore } from "../src/infrastructure/roomStore.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type Session = {
  ok: true;
  roomId: string;
  playerId: string;
  resumeToken: string;
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

function testRegistry() {
  return createGameEngineRegistry(GAME_METADATA.map(metadata =>
    metadata.kind === "doudizhu"
      ? { ...metadata, availability: "available" as const }
      : metadata
  ));
}

describe("SQLite room persistence", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("continues a private three-player game after a server restart", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "gamehost-persistence-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "rooms.sqlite");
    const firstStore = new SqliteRoomStore(databasePath);
    const firstServer = createGameServer({ gameRegistry: testRegistry(), roomStore: firstStore });
    await new Promise<void>(resolve => firstServer.httpServer.listen(0, "127.0.0.1", resolve));
    const firstUrl = `http://127.0.0.1:${(firstServer.httpServer.address() as AddressInfo).port}`;
    const firstClients = await Promise.all(Array.from({ length: 3 }, async () => {
      const socket = createClient(firstUrl, {
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
      });
      if (!socket.connected) await waitFor(socket, "connect");
      return socket;
    }));

    const hostSession = await emitAck<Session>(firstClients[0]!, "host:create-room", {
      name: "房主",
      gameKind: "doudizhu",
    });
    const sessions = [hostSession];
    for (let index = 1; index < 3; index += 1) {
      sessions.push(await emitAck<Session>(firstClients[index]!, "player:join-room", {
        roomId: hostSession.roomId,
        name: `玩家${index + 1}`,
      }));
    }

    const biddingPromises = firstClients.map(socket =>
      waitFor<DouDizhuPlayerView>(socket, "player:game-state", view => view.phase === "bidding")
    );
    expect(await emitAck<{ ok: boolean }>(firstClients[0]!, "host:start-game", {})).toEqual({
      ok: true,
    });
    const bidding = await Promise.all(biddingPromises);
    const bidderIndex = sessions.findIndex(session => session.playerId === bidding[0]!.currentPlayerId);
    const playingPromises = firstClients.map(socket =>
      waitFor<DouDizhuPlayerView>(socket, "player:game-state", view => view.phase === "playing")
    );
    expect(await emitAck<{ ok: boolean }>(firstClients[bidderIndex]!, "game:command", {
      type: "bid",
      bid: 3,
      requestId: "persisted-bid",
      actionId: bidding[bidderIndex]!.actionId,
      stateRevision: bidding[bidderIndex]!.revision,
    })).toMatchObject({ ok: true });
    const beforeRestart = await Promise.all(playingPromises);

    for (const client of firstClients) client.disconnect();
    await new Promise<void>(resolve => firstServer.io.close(() => resolve()));
    firstStore.close();

    const secondStore = new SqliteRoomStore(databasePath);
    const secondServer = createGameServer({ gameRegistry: testRegistry(), roomStore: secondStore });
    const restoredRoom = secondServer.rooms.get(hostSession.roomId)!;
    expect(restoredRoom.gameKind).toBe("doudizhu");
    expect(restoredRoom.players.every(player => !player.connected && player.socketId === null)).toBe(true);
    await new Promise<void>(resolve => secondServer.httpServer.listen(0, "127.0.0.1", resolve));
    const secondUrl = `http://127.0.0.1:${(secondServer.httpServer.address() as AddressInfo).port}`;
    const resumedClients: ClientSocket[] = [];

    for (let index = 0; index < sessions.length; index += 1) {
      const socket = createClient(secondUrl, {
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
      });
      resumedClients.push(socket);
      if (!socket.connected) await waitFor(socket, "connect");
      const viewPromise = waitFor<DouDizhuPlayerView>(
        socket,
        "player:game-state",
        view => view.phase === "playing",
      );
      expect(await emitAck<{ ok: boolean }>(socket, "player:resume", {
        roomId: sessions[index]!.roomId,
        playerId: sessions[index]!.playerId,
        resumeToken: sessions[index]!.resumeToken,
      })).toMatchObject({ ok: true });
      const restoredView = await viewPromise;
      expect(restoredView.hand).toEqual(beforeRestart[index]!.hand);
      expect(restoredView).toMatchObject({
        revision: beforeRestart[index]!.revision,
        actionId: beforeRestart[index]!.actionId,
        landlordPlayerId: beforeRestart[index]!.landlordPlayerId,
      });
    }

    const events = secondStore.listEvents(hostSession.roomId);
    expect(events.map(event => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(events.map(event => event.eventType)).toEqual(expect.arrayContaining([
      "room_created",
      "game_started",
      "command:bid",
      "doudizhu:landlord-selected",
      "player_resumed",
    ]));

    for (const client of resumedClients) client.disconnect();
    await new Promise<void>(resolve => secondServer.io.close(() => resolve()));
    secondStore.close();
  });

  it("caps per-room events while keeping sequence monotonic", () => {
    const store = new SqliteRoomStore(":memory:", { maxEventsPerRoom: 3 });
    for (let index = 0; index < 5; index += 1) {
      store.appendEvent({ roomId: "123456", eventType: `event-${index}` });
    }
    expect(store.listEvents("123456").map(event => event.sequence)).toEqual([3, 4, 5]);
    store.close();
  });
});
