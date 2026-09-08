import { describe, expect, it } from "vitest";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import {
  configFromRoleDeck,
  confirmRole,
  startGame,
} from "../src/domain/game.js";
import { CLIENT_PROTOCOL_VERSION } from "../src/protocol/client/ClientProtocol.js";
import { CloudflareRoomRealtime } from "../src/runtime/cloudflare/CloudflareRoomRealtime.js";
import type {
  DurableObjectHibernationStateLike,
  HibernationWebSocketLike,
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
    if (typeof message !== "string") throw new Error("test expects text frames");
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
  readonly connections: Array<{ socket: HibernationWebSocketLike; tags: string[] }> = [];

  acceptWebSocket(socket: HibernationWebSocketLike, tags: string[] = []): void {
    this.connections.push({ socket, tags: [...tags] });
  }

  getWebSockets(tag?: string): HibernationWebSocketLike[] {
    return this.connections
      .filter(connection => connection.socket.readyState !== 3)
      .filter(connection => tag === undefined || connection.tags.includes(tag))
      .map(connection => connection.socket);
  }
}

function stateLike(storage: MemoryStorage, realtime: FakeHibernationState) {
  return {
    id: { toString: () => "object-123" },
    storage,
    acceptWebSocket: realtime.acceptWebSocket.bind(realtime),
    getWebSockets: realtime.getWebSockets.bind(realtime),
  };
}

function startedSnapshot() {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const config = configFromRoleDeck(
    5,
    ["werewolf", "seer", "witch", "villager", "villager"],
  );
  let sequence = 0;
  const random = {
    randomInt(maxExclusive: number) {
      return maxExclusive - 1;
    },
    randomId() {
      sequence += 1;
      return `setup-${sequence}`;
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

function parseFrame(socket: FakeWebSocket, index: number) {
  return JSON.parse(socket.sent[index]!) as Record<string, any>;
}

describe("E3.2 raw WebSocket client framing", () => {
  it("returns a correlated authoritative state response for client:sync-state", async () => {
    const storage = new MemoryStorage();
    const realtimeState = new FakeHibernationState();
    const snapshot = startedSnapshot();
    await new CloudflareRoomSnapshotRepository(storage).save(snapshot);

    const socket = new FakeWebSocket();
    new CloudflareRoomRealtime(realtimeState).acceptPlayerSocket(socket, "p2");
    const room = new GameRoomDurableObject(stateLike(storage, realtimeState));

    await room.webSocketMessage(socket, JSON.stringify({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId: "sync-1",
      type: "client:sync-state",
      payload: {},
    }));

    expect(socket.sent).toHaveLength(1);
    const response = parseFrame(socket, 0);
    expect(response).toMatchObject({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: "sync-1",
      ok: true,
      payload: {
        revision: 7,
        envelope: {
          protocolVersion: CLIENT_PROTOCOL_VERSION,
          kind: "state",
          scope: "player",
          roomId: "1234",
          playerId: "p2",
        },
      },
    });
  });

  it("keeps malformed versioned requests nonfatal and correlates the error when possible", async () => {
    const storage = new MemoryStorage();
    const realtimeState = new FakeHibernationState();
    await new CloudflareRoomSnapshotRepository(storage).save(startedSnapshot());
    const socket = new FakeWebSocket();
    new CloudflareRoomRealtime(realtimeState).acceptPlayerSocket(socket, "p2");
    const room = new GameRoomDurableObject(stateLike(storage, realtimeState));

    await room.webSocketMessage(socket, JSON.stringify({
      protocolVersion: 999,
      kind: "request",
      requestId: "bad-1",
      type: "client:sync-state",
      payload: {},
    }));

    expect(parseFrame(socket, 0)).toMatchObject({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: "bad-1",
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(socket.readyState).toBe(1);
  });

  it("ACKs a stable command separately and pushes the new authoritative state to connected players", async () => {
    const storage = new MemoryStorage();
    const realtimeState = new FakeHibernationState();
    const snapshot = startedSnapshot();
    await new CloudflareRoomSnapshotRepository(storage).save(snapshot);

    const actor = new FakeWebSocket();
    const host = new FakeWebSocket();
    const realtime = new CloudflareRoomRealtime(realtimeState);
    realtime.acceptPlayerSocket(actor, "p5");
    realtime.acceptPlayerSocket(host, "p1");
    const room = new GameRoomDurableObject(stateLike(storage, realtimeState));

    await room.webSocketMessage(actor, JSON.stringify({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId: "command-1",
      type: "client:command",
      payload: {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: "confirm-final-role",
        type: "werewolf.confirmRole",
        payload: { actionId: snapshot.game!.actionId },
      },
    }));

    expect(actor.sent.length).toBeGreaterThanOrEqual(2);
    expect(parseFrame(actor, 0)).toMatchObject({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: "command-1",
      ok: true,
      payload: { replayed: false, revision: 8 },
    });
    expect(parseFrame(actor, 1)).toMatchObject({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: {
        revision: 8,
        envelope: { kind: "state", scope: "player", playerId: "p5" },
      },
    });
    expect(parseFrame(host, 0)).toMatchObject({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: {
        revision: 8,
        envelope: { kind: "state", scope: "player", playerId: "p1" },
      },
    });
  });
});
