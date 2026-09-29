import { describe, expect, it, vi } from "vitest";
import type { GameType } from "../../src/games/GameCatalog.js";
import { InMemoryCloudflareMultiplayerHarness } from "./InMemoryCloudflareMultiplayerHarness.js";
import { TestRoomClient } from "./TestRoomClient.js";

type LobbyView = {
  phase: string;
  mode?: string;
};

type ParsedClientFrame = {
  requestId?: string;
  operation?: string;
  envelope?: { commandId?: string };
};

type ParsedServerFrame = {
  kind?: string;
  requestId?: string;
  revision?: number;
  envelope?: { scope?: string };
};

function createClient(
  runtime: InMemoryCloudflareMultiplayerHarness,
  label: string,
  gameType: GameType,
  options: { requestTimeoutMs?: number; commandRetries?: number } = {},
): TestRoomClient<LobbyView> {
  return new TestRoomClient<LobbyView>({
    label,
    gameType,
    baseUrl: runtime.baseUrl,
    fetch: runtime.fetch,
    webSocketFactory: runtime.webSocketFactory,
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.commandRetries === undefined
      ? {}
      : { commandRetries: options.commandRetries }),
  });
}

function parseFrame<T>(frame: string | ArrayBuffer): T | null {
  if (typeof frame !== "string") return null;
  try {
    return JSON.parse(frame) as T;
  } catch {
    return null;
  }
}

function roomStateFrameAtRevision(
  frames: Array<string | ArrayBuffer>,
  revision: number,
): string {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index]!;
    const parsed = parseFrame<ParsedServerFrame>(frame);
    if (
      typeof frame === "string" &&
      parsed?.kind === "state" &&
      parsed.revision === revision &&
      parsed.envelope?.scope === "room"
    ) {
      return frame;
    }
  }
  throw new Error(`missing room state frame for revision ${revision}`);
}

function roomTraceCount(client: TestRoomClient<LobbyView>): number {
  return client.captureTrace().filter(entry => entry.event === "room-state").length;
}

describe.each(["werewolf", "botc"] satisfies GameType[])(
  "T3 reconnect / deterministic fault injection — %s",
  gameType => {
    it("keeps the room progressing while one client is offline and fences stale generations/revisions after reconnect", async () => {
      const runtime = new InMemoryCloudflareMultiplayerHarness();
      const host = createClient(runtime, `${gameType}-host`, gameType);
      const player = createClient(runtime, `${gameType}-player`, gameType);
      const observer = createClient(runtime, `${gameType}-observer`, gameType);

      const hostCredentials = await host.createRoom("Host");
      await host.connect();
      const playerCredentials = await player.joinRoom(
        hostCredentials.roomId,
        "Player",
      );
      await player.connect();
      await observer.joinRoom(hostCredentials.roomId, "Observer");
      await observer.connect();

      await Promise.all([
        host.waitForRevision(2),
        player.waitForRevision(2),
        observer.waitForRevision(2),
      ]);

      const staleRevisionTwo = roomStateFrameAtRevision(
        runtime.captureServerFrames(playerCredentials.playerId),
        2,
      );

      runtime.disconnectPlayer(playerCredentials.playerId);
      expect(player.getConnectionState()).toMatchObject({
        status: "Disconnected",
        generation: 1,
      });
      expect(player.getRoomRevision()).toBe(2);

      await host.sendCommand(
        "room.updateName",
        { name: "Host A" },
        `${gameType}-offline-step-1`,
      );
      await host.sendCommand(
        "room.updateName",
        { name: "Host B" },
        `${gameType}-offline-step-2`,
      );

      await Promise.all([
        host.waitForRevision(4),
        observer.waitForRevision(4),
      ]);
      expect(player.getRoomRevision()).toBe(2);

      await player.reconnect();
      expect(player.getConnectionState()).toMatchObject({
        status: "Connected",
        generation: 2,
      });
      expect(player.getRoomRevision()).toBe(4);
      expect(player.getRoomProjection()).toMatchObject({
        viewer: { playerId: playerCredentials.playerId },
        players: expect.arrayContaining([
          expect.objectContaining({ id: playerCredentials.playerId, name: "Player" }),
          expect.objectContaining({ id: hostCredentials.playerId, name: "Host B" }),
        ]),
      });

      const traceBeforeOldGeneration = player.captureTrace().length;
      runtime.injectRetiredServerFrame(
        playerCredentials.playerId,
        staleRevisionTwo,
      );
      expect(player.getRoomRevision()).toBe(4);
      expect(player.captureTrace()).toHaveLength(traceBeforeOldGeneration);

      const roomTraceBeforeStaleRevision = roomTraceCount(player);
      runtime.injectActiveServerFrame(
        playerCredentials.playerId,
        staleRevisionTwo,
      );
      expect(player.getRoomRevision()).toBe(4);
      expect(roomTraceCount(player)).toBe(roomTraceBeforeStaleRevision);

      await host.sendCommand(
        "room.updateName",
        { name: "Host C" },
        `${gameType}-post-reconnect-step`,
      );
      await Promise.all([
        host.waitForRevision(5),
        player.waitForRevision(5),
        observer.waitForRevision(5),
      ]);

      const equalRevisionFive = roomStateFrameAtRevision(
        runtime.captureServerFrames(playerCredentials.playerId),
        5,
      );
      const roomTraceBeforeDuplicate = roomTraceCount(player);
      runtime.injectActiveServerFrame(
        playerCredentials.playerId,
        equalRevisionFive,
      );
      expect(player.getRoomRevision()).toBe(5);
      expect(roomTraceCount(player)).toBe(roomTraceBeforeDuplicate);

      host.disconnect();
      player.disconnect();
      observer.disconnect();
    });

    it("retries a dropped ACK with a new requestId and the same commandId without advancing revision twice", async () => {
      const runtime = new InMemoryCloudflareMultiplayerHarness();
      const host = createClient(
        runtime,
        `${gameType}-retry-host`,
        gameType,
        { requestTimeoutMs: 50, commandRetries: 1 },
      );
      const observer = createClient(runtime, `${gameType}-retry-observer`, gameType);

      const hostCredentials = await host.createRoom("Host");
      await host.connect();
      await observer.joinRoom(hostCredentials.roomId, "Observer");
      await observer.connect();
      await Promise.all([
        host.waitForRevision(1),
        observer.waitForRevision(1),
      ]);

      runtime.dropNextResponse(hostCredentials.playerId);
      vi.useFakeTimers();
      let result: unknown;
      try {
        const pending = host.sendCommand(
          "room.updateName",
          { name: "Retried Host" },
          `${gameType}-same-logical-command`,
        );

        await vi.advanceTimersByTimeAsync(50);
        result = await pending;
      } finally {
        vi.useRealTimers();
      }

      expect(result).toMatchObject({
        revision: 2,
        replayed: true,
      });
      await Promise.all([
        host.waitForRevision(2),
        observer.waitForRevision(2),
      ]);
      expect(host.getRoomRevision()).toBe(2);
      expect(observer.getRoomRevision()).toBe(2);
      expect(observer.getRoomProjection()?.players[0]?.name).toBe("Retried Host");

      const commandFrames = runtime
        .captureClientFrames(hostCredentials.playerId)
        .map(frame => parseFrame<ParsedClientFrame>(frame))
        .filter((frame): frame is ParsedClientFrame =>
          frame?.operation === "command" &&
          frame.envelope?.commandId === `${gameType}-same-logical-command`
        );

      expect(commandFrames).toHaveLength(2);
      expect(commandFrames[0]?.requestId).toEqual(expect.any(String));
      expect(commandFrames[1]?.requestId).toEqual(expect.any(String));
      expect(commandFrames[1]?.requestId).not.toBe(commandFrames[0]?.requestId);
      expect(commandFrames.map(frame => frame.envelope?.commandId)).toEqual([
        `${gameType}-same-logical-command`,
        `${gameType}-same-logical-command`,
      ]);

      const firstRequestId = commandFrames[0]!.requestId!;
      const lateDroppedAck = runtime
        .captureServerFrames(hostCredentials.playerId)
        .find(frame => {
          const parsed = parseFrame<ParsedServerFrame>(frame);
          return parsed?.kind === "response" && parsed.requestId === firstRequestId;
        });
      expect(lateDroppedAck).toEqual(expect.any(String));

      const traceBeforeLateAck = host.captureTrace().length;
      runtime.injectActiveServerFrame(
        hostCredentials.playerId,
        lateDroppedAck!,
      );
      expect(host.getRoomRevision()).toBe(2);
      expect(host.captureTrace()).toHaveLength(traceBeforeLateAck);

      host.disconnect();
      observer.disconnect();
    });
  },
);
