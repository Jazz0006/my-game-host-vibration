import { describe, expect, it } from "vitest";
import { configFromPlayerCount } from "../src/domain/game.js";
import {
  actingPlayerIds,
  createWerewolfGame,
  hostRecoveryStatus,
  roomGameView,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";
import {
  runHostCommand,
  runPlayerCommand,
} from "../src/runtime/node/werewolfCommandFacade.js";

function room(): RuntimeRoom {
  const config = configFromPlayerCount(5);
  return {
    id: "123456",
    gameType: "werewolf",
    players: Array.from({ length: 5 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `玩家${index + 1}`,
      seat: index + 1,
      isHost: index === 0,
      resumeTokenHash: String(index + 1).repeat(64),
      socketId: `s${index + 1}`,
      connected: true,
    })),
    createdAt: 1,
    updatedAt: 1,
    gameConfig: config,
  };
}

function prepareActiveInteraction(currentRoom: RuntimeRoom): string[] {
  const game = createWerewolfGame(currentRoom, currentRoom.gameConfig);
  const roleRevealActionId = game.actionId;

  for (const player of currentRoom.players) {
    runPlayerCommand(currentRoom, player.id, {
      type: "confirmRole",
      actionId: roleRevealActionId,
    });
  }

  runHostCommand(currentRoom, { type: "startNight" });
  const actors = actingPlayerIds(currentRoom);
  expect(actors.length).toBeGreaterThan(0);
  return actors;
}

describe("C4.2 host recovery status", () => {
  it("reports waiting availability without exposing actor identity", () => {
    const currentRoom = room();
    const actors = prepareActiveInteraction(currentRoom);

    const offlineActor = currentRoom.players.find(player => player.id === actors[0]);
    expect(offlineActor).toBeDefined();
    offlineActor!.connected = false;
    offlineActor!.socketId = null;

    expect(hostRecoveryStatus(currentRoom)).toEqual({
      hasPendingInteraction: true,
      waitingCount: actors.length,
      onlineWaitingCount: actors.length - 1,
      offlineWaitingCount: 1,
    });

    const serialized = JSON.stringify(hostRecoveryStatus(currentRoom));
    for (const actorId of actors) expect(serialized).not.toContain(actorId);
    for (const player of currentRoom.players) expect(serialized).not.toContain(player.name);
  });

  it("adds recovery diagnostics only to the host game projection", () => {
    const currentRoom = room();
    prepareActiveInteraction(currentRoom);

    const hostView = roomGameView(currentRoom, true);
    const publicView = roomGameView(currentRoom, false);

    expect(hostView).toHaveProperty("recovery");
    expect(publicView).not.toHaveProperty("recovery");

    const recovery = hostView?.recovery as Record<string, unknown>;
    expect(recovery).toEqual({
      hasPendingInteraction: true,
      waitingCount: expect.any(Number),
      onlineWaitingCount: expect.any(Number),
      offlineWaitingCount: expect.any(Number),
    });
    expect(recovery).not.toHaveProperty("actorPlayerIds");
    expect(recovery).not.toHaveProperty("roles");
    expect(recovery).not.toHaveProperty("answers");
  });

  it("returns an empty diagnostic when no game exists", () => {
    expect(hostRecoveryStatus(room())).toEqual({
      hasPendingInteraction: false,
      waitingCount: 0,
      onlineWaitingCount: 0,
      offlineWaitingCount: 0,
    });
  });
});
