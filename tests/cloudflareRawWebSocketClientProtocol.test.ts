import { describe, expect, it } from "vitest";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import { configFromRoleDeck, confirmRole, startGame } from "../src/domain/game.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketCommandRequest,
  createClientRawWebSocketSyncRequest,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import {
  CloudflareRoomRealtime,
  type DurableObjectHibernationStateLike,
  type HibernationWebSocketLike,
} from "../src/runtime/cloudflare/CloudflareRoomRealtime.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

class FakeWebSocket implements HibernationWebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  attachment: unknown;

  send(message: string | ArrayBuffer): void {
    if (typeof message !== "string") throw new Error("test only supports text frames");
    this.sent.push(message);
  }

  close(): void {
    this.readyState = 3;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
}

class FakeHibernationState implements DurableObjectHibernationStateLike {
  readonly connections: Array<{ webSocket: HibernationWebSocketLike; tags: string[] }> = [];

  acceptWebSocket(webSocket: HibernationWebSocketLike, tags: string[] = []): void {
    this.connections.push({ webSocket, tags: [...tags] });
  }

  getWebSockets(tag?: string): HibernationWebSocketLike[] {
    return this.connections
      .filter(item => item.webSocket.readyState !== 3)
      .filter(item => tag === undefined || item.tags.includes(tag))
      .map(item => item.webSocket);
  }
}

function stateLike(storage: MemoryStorage, hibernation: FakeHibernationState) {
  return {
    id: { toString: () => "object-123" },
    storage,
    acceptWebSocket: hibernation.acceptWebSocket.bind(hibernation),
    getWebSockets: hibernation.getWebSockets.bind(hibernation),
  };
}

function lobbySnapshot() {
  return createRoomSnapshot(
    {
      id: "1234",
      gameType: "werewolf",
      players: [{
        id: "p1",
        name: "Host",
        seat: 1,
        isHost: true,
        resumeTokenHash: "1".repeat(64),
      }],
      createdAt: 10,
      updatedAt: 20,
      gameConfig: { playerCount: 5, roleDeck: ["werewolf"] },
    },
    { revision: 3 },
  );
}

function activeSnapshot() {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const config = configFromRoleDeck(
    5,
    ["werewolf", "seer", "witch", "villager", "villager"],
  );
  const random = {
    randomInt(maxExclusive: number) {
      return maxExclusive - 1;
    },
    randomId() {
      return "setup-action";
    },
  };
  const game = startGame(playerIds, config, random);
  for (const playerId of playerIds.slice(0, -1)) {
    confirmRole(game, playerId, game.actionId, random);
  }

  return createRoomSnapshot(
    {
      id: "1234",
      gameType: "werewolf",
      players: playerIds.map((id, index) => ({
        id,
        name: `Player ${index + 1}`,
        seat: index + 1,
        isHost: index === 0,
        resumeTokenHash: String(index + 1).repeat(64),
      })),
      createdAt: 10,
      updatedAt: 20,
      gameConfig: config,
      game,
    },
    { revision: 7 },
  );
}

function parsedFrames(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map(value => JSON.parse(value) as Record<string, unknown>);
}

describe("E3.2b Cloudflare Raw WebSocket client protocol bridge", () => {
  it("returns a correlated authoritative PlayerView sync response", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(lobbySnapshot());
    const hibernation = new FakeHibernationState();
    const socket = new FakeWebSocket();
    new CloudflareRoomRealtime(hibernation).acceptPlayerSocket(socket, "p1");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    await room.webSocketMessage(socket, JSON.stringify(createClientRawWebSocketSyncRequest("sync-1")));

    expect(parsedFrames(socket).at(-1)).toMatchObject({
      wireVersion: 1,
      kind: "response",
      requestId: "sync-1",
      ok: true,
      result: {
        revision: 3,
        envelope: {
          protocolVersion: 1,
          kind: "state",
          scope: "player",
          roomId: "1234",
          playerId: "p1",
          payload: { phase: "lobby", mode: "lobby" },
        },
      },
    });
  });

  it("replays the same commandId under a new requestId without advancing revision twice", async () => {
    const storage = new MemoryStorage();
    const initial = activeSnapshot();
    await new CloudflareRoomSnapshotRepository(storage).save(initial);
    const hibernation = new FakeHibernationState();
    const actor = new FakeWebSocket();
    const host = new FakeWebSocket();
    const realtime = new CloudflareRoomRealtime(hibernation);
    realtime.acceptPlayerSocket(actor, "p5");
    realtime.acceptPlayerSocket(host, "p1");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: initial.game!.actionId },
      "confirm-final",
    );

    await room.webSocketMessage(
      actor,
      JSON.stringify(createClientRawWebSocketCommandRequest("request-1", command)),
    );

    const firstActorFrames = parsedFrames(actor);
    expect(firstActorFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "response",
        requestId: "request-1",
        ok: true,
        result: { revision: 8, replayed: false },
      }),
      expect.objectContaining({
        kind: "state",
        revision: 8,
        envelope: expect.objectContaining({ playerId: "p5" }),
      }),
    ]));
    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "state",
      revision: 8,
      envelope: expect.objectContaining({ playerId: "p1" }),
    }));

    await room.webSocketMessage(
      actor,
      JSON.stringify(createClientRawWebSocketCommandRequest("request-2", command)),
    );

    expect(parsedFrames(actor)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "request-2",
      ok: true,
      result: { revision: 8, replayed: true },
    }));

    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(8);
    expect((persisted?.game as { phase?: string } | undefined)?.phase).toBe("night_start");
  });

  it("returns a correlated application failure for a valid unsupported lifecycle command", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(lobbySnapshot());
    const hibernation = new FakeHibernationState();
    const socket = new FakeWebSocket();
    new CloudflareRoomRealtime(hibernation).acceptPlayerSocket(socket, "p1");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "werewolf.startGame",
      {},
      "start-game-1",
    );
    await room.webSocketMessage(
      socket,
      JSON.stringify(createClientRawWebSocketCommandRequest("request-lifecycle", command)),
    );

    expect(parsedFrames(socket).at(-1)).toMatchObject({
      wireVersion: 1,
      kind: "response",
      requestId: "request-lifecycle",
      ok: false,
      error: {
        code: "unsupported_command",
      },
    });
  });

  it("uses stable protocol-error frames for malformed Raw WebSocket traffic", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(lobbySnapshot());
    const hibernation = new FakeHibernationState();
    const socket = new FakeWebSocket();
    new CloudflareRoomRealtime(hibernation).acceptPlayerSocket(socket, "p1");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    await room.webSocketMessage(socket, "{");
    await room.webSocketMessage(socket, JSON.stringify({
      wireVersion: 99,
      kind: "request",
      requestId: "bad-version",
      operation: "sync",
    }));

    expect(parsedFrames(socket).slice(-2)).toEqual([
      expect.objectContaining({
        wireVersion: 1,
        kind: "error",
        code: "invalid_json",
      }),
      expect.objectContaining({
        wireVersion: 1,
        kind: "error",
        requestId: "bad-version",
        code: "unsupported_wire_version",
      }),
    ]);
  });
});
