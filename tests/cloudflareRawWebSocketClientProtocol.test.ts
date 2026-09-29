import { describe, expect, it } from "vitest";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import { configFromRoleDeck, confirmRole, startGame } from "../src/domain/game.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketCommandRequest,
  createClientRawWebSocketSyncRequest,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import { CloudflareInteractionTimeoutRepository } from "../src/runtime/cloudflare/CloudflareInteractionTimeoutRepository.js";
import {
  CloudflareRoomRealtime,
  type DurableObjectHibernationStateLike,
  type HibernationWebSocketLike,
} from "../src/runtime/cloudflare/CloudflareRoomRealtime.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  alarmAt: number | null = null;

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

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async setAlarm(scheduledTimeMs: number): Promise<void> {
    this.alarmAt = scheduledTimeMs;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

class FakeWebSocket implements HibernationWebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  closed?: { code?: number; reason?: string };
  attachment: unknown;

  send(message: string | ArrayBuffer): void {
    if (typeof message !== "string") throw new Error("test only supports text frames");
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
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

function fivePlayerLobbySnapshot() {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  return createRoomSnapshot(
    {
      id: "1234",
      gameType: "werewolf",
      players: playerIds.map((id, index) => ({
        id,
        name: index === 0 ? "Host" : `Player ${index + 1}`,
        seat: index + 1,
        isHost: index === 0,
        resumeTokenHash: String(index + 1).repeat(64),
      })),
      createdAt: 10,
      updatedAt: 20,
      gameConfig: configFromRoleDeck(
        5,
        ["werewolf", "seer", "witch", "villager", "villager"],
      ),
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

function wolfActionSnapshot() {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const config = configFromRoleDeck(
    5,
    ["werewolf", "seer", "witch", "villager", "villager"],
  );
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
      game: {
        config,
        phase: "night_werewolf" as const,
        nightNumber: 1,
        dayNumber: 0,
        roles: {
          p1: "werewolf" as const,
          p2: "seer" as const,
          p3: "witch" as const,
          p4: "villager" as const,
          p5: "villager" as const,
        },
        confirmedRolePlayerIds: [...playerIds],
        actionId: "wolf-action",
        witchUsedAntidote: false,
        witchAntidoteSpent: false,
        witchPoisonSpent: false,
        seerResultConfirmed: false,
        deaths: [],
        votes: {},
        pkCandidateIds: [],
        deadPlayerIds: [],
      },
    },
    { revision: 20 },
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
        roomEnvelope: {
          protocolVersion: 1,
          kind: "state",
          scope: "room",
          roomId: "1234",
          payload: {
            roomId: "1234",
            gameType: "werewolf",
            viewer: { playerId: "p1", isHost: true },
            players: [{
              id: "p1",
              name: "Host",
              seat: 1,
              isHost: true,
            }],
            gameStarted: false,
          },
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

  it("starts a five-player lobby through the Cloudflare lifecycle command and replays safely", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(fivePlayerLobbySnapshot());
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const sockets = new Map<string, FakeWebSocket>();
    for (const playerId of ["p1", "p2", "p3", "p4", "p5"]) {
      const playerSocket = new FakeWebSocket();
      sockets.set(playerId, playerSocket);
      realtime.acceptPlayerSocket(playerSocket, playerId);
    }
    const socket = sockets.get("p1")!;

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "werewolf.startGame",
      {},
      "start-game-1",
    );
    await room.webSocketMessage(
      socket,
      JSON.stringify(createClientRawWebSocketCommandRequest("request-lifecycle-1", command)),
    );

    expect(parsedFrames(socket)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "request-lifecycle-1",
      ok: true,
      result: { revision: 4, replayed: false },
    }));
    expect(parsedFrames(socket)).toContainEqual(expect.objectContaining({
      kind: "state",
      revision: 4,
      envelope: expect.objectContaining({
        scope: "room",
        roomId: "1234",
        payload: expect.objectContaining({ gameStarted: true }),
      }),
    }));

    await room.webSocketMessage(
      socket,
      JSON.stringify(createClientRawWebSocketCommandRequest("request-lifecycle-2", command)),
    );
    expect(parsedFrames(socket)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "request-lifecycle-2",
      ok: true,
      result: { revision: 4, replayed: true },
    }));

    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(4);
    expect((persisted?.game as { phase?: string } | undefined)?.phase).toBe("role_reveal");
  });

  it("executes idempotent Cloudflare room removal and delivers the stable removed lifecycle event", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(fivePlayerLobbySnapshot());
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const sockets = new Map<string, FakeWebSocket>();
    for (const playerId of ["p1", "p2", "p3", "p4", "p5"]) {
      const playerSocket = new FakeWebSocket();
      sockets.set(playerId, playerSocket);
      realtime.acceptPlayerSocket(playerSocket, playerId);
    }
    const host = sockets.get("p1")!;
    const removed = sockets.get("p2")!;
    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "room.removePlayer",
      { targetPlayerId: "p2" },
      "remove-p2",
    );

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("remove-request-1", command)),
    );

    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "remove-request-1",
      ok: true,
      result: {
        revision: 4,
        replayed: false,
        outcome: { kind: "removedPlayer", playerId: "p2" },
      },
    }));
    expect(parsedFrames(removed)).toContainEqual(expect.objectContaining({
      kind: "event",
      envelope: {
        protocolVersion: 1,
        kind: "event",
        type: "room.removed",
        payload: { roomId: "1234", reason: "removed" },
      },
    }));
    expect(removed.closed).toEqual({ code: 4004, reason: "removed from room" });

    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(4);
    expect(persisted?.membership.map(player => player.id)).not.toContain("p2");

    const removedFrameCount = removed.sent.length;
    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("remove-request-2", command)),
    );
    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "remove-request-2",
      ok: true,
      result: {
        revision: 4,
        replayed: true,
        outcome: { kind: "removedPlayer", playerId: "p2" },
      },
    }));
    expect(removed.sent).toHaveLength(removedFrameCount);
    expect((await new CloudflareRoomSnapshotRepository(storage).load())?.revision).toBe(4);
  });

  it("clears Cloudflare room authority only after delivering the stable room-closed event", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(fivePlayerLobbySnapshot());
    await new CloudflareInteractionTimeoutRepository(storage).save({
      timeoutSeconds: 15,
      active: {
        roomId: "1234",
        actionId: "stale-action",
        actorPlayerIds: ["p2"],
        startedAt: 1,
        warningAt: 2,
        deadlineAt: 3,
        warningSent: false,
        extensionCount: 0,
      },
      receipts: [],
    });
    storage.alarmAt = 2;
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const host = new FakeWebSocket();
    const player = new FakeWebSocket();
    realtime.acceptPlayerSocket(host, "p1");
    realtime.acceptPlayerSocket(player, "p2");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope("room.close", {}, "close-room-1");
    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("close-request-1", command)),
    );

    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "close-request-1",
      ok: true,
      result: {
        revision: 4,
        replayed: false,
        outcome: { kind: "closedRoom", roomId: "1234" },
      },
    }));
    for (const socket of [host, player]) {
      expect(parsedFrames(socket)).toContainEqual(expect.objectContaining({
        kind: "event",
        envelope: {
          protocolVersion: 1,
          kind: "event",
          type: "room.closed",
          payload: { roomId: "1234", reason: "host_closed" },
        },
      }));
      expect(socket.closed).toEqual({ code: 4005, reason: "room closed" });
    }
    expect(await new CloudflareRoomSnapshotRepository(storage).load()).toBeUndefined();
    expect(await new CloudflareInteractionTimeoutRepository(storage).load()).toEqual({
      timeoutSeconds: 30,
      receipts: [],
    });
    expect(storage.alarmAt).toBeNull();
  });

  it("serves interaction timeout configuration through the Raw WebSocket command contract", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(lobbySnapshot());
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const host = new FakeWebSocket();
    realtime.acceptPlayerSocket(host, "p1");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const setCommand = createClientCommandEnvelope(
      "interactionTimeout.setConfig",
      { timeoutSeconds: 15 },
      "timeout-config-raw-1",
    );

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("timeout-set-1", setCommand)),
    );
    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "timeout-set-1",
      ok: true,
      result: {
        replayed: false,
        timeoutSeconds: 15,
      },
    }));

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("timeout-set-2", setCommand)),
    );
    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "timeout-set-2",
      ok: true,
      result: {
        replayed: true,
        timeoutSeconds: 15,
      },
    }));

    const getCommand = createClientCommandEnvelope(
      "interactionTimeout.getConfig",
      {},
      "timeout-config-get-1",
    );
    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("timeout-get-1", getCommand)),
    );
    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "timeout-get-1",
      ok: true,
      result: {
        replayed: false,
        timeoutSeconds: 15,
      },
    }));
  });

  it("replays a Cloudflare recovery reminder without delivering the transient alert twice", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(wolfActionSnapshot());
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const host = new FakeWebSocket();
    const nonHost = new FakeWebSocket();
    realtime.acceptPlayerSocket(host, "p1");
    realtime.acceptPlayerSocket(nonHost, "p2");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "recovery.resendCurrentAction",
      {},
      "recovery-reminder-1",
    );

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("recovery-request-1", command)),
    );

    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "recovery-request-1",
      ok: true,
      result: {
        revision: 21,
        replayed: false,
        outcome: {
          kind: "hostRecoveryReminder",
          actorPlayerIds: ["p1"],
          actionId: "wolf-action",
          phase: "night_werewolf",
        },
      },
    }));
    const firstAlerts = parsedFrames(host).filter(frame =>
      frame.kind === "event" &&
      (frame.envelope as { type?: string } | undefined)?.type === "client.effect.vibrate"
    );
    expect(firstAlerts).toHaveLength(1);
    expect(firstAlerts[0]).toMatchObject({
      envelope: {
        type: "client.effect.vibrate",
        payload: {
          pattern: [300, 150, 300],
          reason: "action-alert",
          context: {
            actionId: "wolf-action",
            phase: "night_werewolf",
            resumed: true,
          },
        },
      },
    });

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("recovery-request-2", command)),
    );

    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "recovery-request-2",
      ok: true,
      result: {
        revision: 21,
        replayed: true,
        outcome: expect.objectContaining({ kind: "hostRecoveryReminder" }),
      },
    }));
    const replayAlerts = parsedFrames(host).filter(frame =>
      frame.kind === "event" &&
      (frame.envelope as { type?: string } | undefined)?.type === "client.effect.vibrate"
    );
    expect(replayAlerts).toHaveLength(1);

    await room.webSocketMessage(
      nonHost,
      JSON.stringify(createClientRawWebSocketCommandRequest("recovery-request-3", command)),
    );
    expect(parsedFrames(nonHost)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "recovery-request-3",
      ok: false,
      error: expect.objectContaining({
        code: "command_failed",
        message: "只有房主可以重新提醒当前行动",
      }),
    }));
    expect((await new CloudflareRoomSnapshotRepository(storage).load())?.revision).toBe(21);
  });

  it("aborts a Cloudflare game to lobby while preserving membership and replaying safely", async () => {
    const storage = new MemoryStorage();
    const active = {
      ...wolfActionSnapshot(),
      ruleState: { marker: "old-game-rule-state" },
    };
    await new CloudflareRoomSnapshotRepository(storage).save(active);
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const host = new FakeWebSocket();
    const player = new FakeWebSocket();
    realtime.acceptPlayerSocket(host, "p1");
    realtime.acceptPlayerSocket(player, "p2");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "recovery.abortToLobby",
      {},
      "abort-to-lobby-1",
    );

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("abort-request-1", command)),
    );

    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "abort-request-1",
      ok: true,
      result: {
        revision: 21,
        replayed: false,
        outcome: { kind: "abortedToLobby" },
      },
    }));
    expect(parsedFrames(player)).toContainEqual(expect.objectContaining({
      kind: "state",
      revision: 21,
      envelope: expect.objectContaining({
        scope: "player",
        playerId: "p2",
        payload: { phase: "lobby", mode: "lobby" },
      }),
    }));

    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(21);
    expect(persisted?.game).toBeUndefined();
    expect(persisted?.pendingInteraction).toBeUndefined();
    expect(persisted?.ruleState).toBeUndefined();
    expect(persisted?.membership.map(member => member.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
    ]);

    await room.webSocketMessage(
      host,
      JSON.stringify(createClientRawWebSocketCommandRequest("abort-request-2", command)),
    );
    expect(parsedFrames(host)).toContainEqual(expect.objectContaining({
      kind: "response",
      requestId: "abort-request-2",
      ok: true,
      result: {
        revision: 21,
        replayed: true,
        outcome: { kind: "abortedToLobby" },
      },
    }));
    expect((await new CloudflareRoomSnapshotRepository(storage).load())?.revision).toBe(21);
  });

  it("delivers a persisted Cloudflare timeout warning once across repeated alarm delivery", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(wolfActionSnapshot());
    const now = Date.now();
    const warningAt = now - 1_000;
    const deadlineAt = now + 60_000;
    await new CloudflareInteractionTimeoutRepository(storage).save({
      timeoutSeconds: 30,
      active: {
        roomId: "1234",
        actionId: "wolf-action",
        actorPlayerIds: ["p1"],
        startedAt: now - 20_000,
        warningAt,
        deadlineAt,
        warningSent: false,
        extensionCount: 0,
      },
      receipts: [],
    });
    storage.alarmAt = warningAt;

    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const wolf = new FakeWebSocket();
    realtime.acceptPlayerSocket(wolf, "p1");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    await room.alarm();

    const warningFrames = parsedFrames(wolf).filter(frame =>
      frame.kind === "event"
    );
    expect(warningFrames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        envelope: {
          protocolVersion: 1,
          kind: "event",
          type: "client.effect.vibrate",
          payload: {
            pattern: [300, 150, 300],
            reason: "action-alert",
            context: {
              actionId: "wolf-action",
              phase: "night_werewolf",
              timeoutWarning: true,
            },
          },
        },
      }),
      expect.objectContaining({
        envelope: {
          protocolVersion: 1,
          kind: "event",
          type: "interaction.timeout-state",
          payload: {
            roomId: "1234",
            active: true,
            actionId: "wolf-action",
            deadlineAt,
            warningAt,
            warning: true,
            canExtend: true,
            extensionCount: 0,
          },
        },
      }),
    ]));
    expect(storage.alarmAt).toBe(deadlineAt);

    const deliveredCount = wolf.sent.length;
    await room.alarm();
    expect(wolf.sent).toHaveLength(deliveredCount);
    expect(storage.alarmAt).toBe(deadlineAt);
  });

  it("delivers the canonical action-alert effect to the next night actor after a committed action", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(wolfActionSnapshot());
    const hibernation = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(hibernation);
    const wolf = new FakeWebSocket();
    const witch = new FakeWebSocket();
    realtime.acceptPlayerSocket(wolf, "p1");
    realtime.acceptPlayerSocket(witch, "p3");

    const room = new GameRoomDurableObject(stateLike(storage, hibernation));
    const command = createClientCommandEnvelope(
      "werewolf.submitWolfTarget",
      { actionId: "wolf-action", targetPlayerId: "p4" },
      "wolf-target-1",
    );

    await room.webSocketMessage(
      wolf,
      JSON.stringify(createClientRawWebSocketCommandRequest("wolf-request-1", command)),
    );

    expect(parsedFrames(witch)).toContainEqual(expect.objectContaining({
      kind: "event",
      envelope: {
        protocolVersion: 1,
        kind: "event",
        type: "client.effect.vibrate",
        payload: expect.objectContaining({
          pattern: [300, 150, 300],
          reason: "action-alert",
        }),
      },
    }));
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
