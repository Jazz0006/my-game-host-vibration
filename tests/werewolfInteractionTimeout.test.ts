import { describe, expect, it } from "vitest";
import { configFromPlayerCount } from "../src/domain/game.js";
import {
  createWerewolfGame,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";
import { recoverTimedOutWerewolfInteraction } from "../src/runtime/node/werewolfInteractionTimeout.js";

function room(): RuntimeRoom {
  const config = configFromPlayerCount(5);
  const currentRoom: RuntimeRoom = {
    id: "1234",
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
  const game = createWerewolfGame(currentRoom, config);
  game.roles = {
    p1: "guard",
    p2: "werewolf",
    p3: "witch",
    p4: "seer",
    p5: "villager",
  };
  game.confirmedRolePlayerIds = Object.keys(game.roles);
  return currentRoom;
}

describe("C4.4 werewolf interaction timeout recovery", () => {
  it("turns a guard timeout into a legal no-protection action", () => {
    const currentRoom = room();
    currentRoom.game!.phase = "night_guard";
    currentRoom.game!.actionId = "guard-action";

    expect(recoverTimedOutWerewolfInteraction(currentRoom, "guard-action").recovered).toBe(true);
    expect(currentRoom.game!.guardProtectedId).toBeUndefined();
    expect(currentRoom.game!.phase).toBe("night_werewolf");
    expect(currentRoom.game!.actionId).not.toBe("guard-action");
  });

  it("ignores a stale timeout after actionId has already advanced", () => {
    const currentRoom = room();
    currentRoom.game!.phase = "night_werewolf";
    currentRoom.game!.actionId = "new-action";
    const before = JSON.stringify(currentRoom.game);

    expect(recoverTimedOutWerewolfInteraction(currentRoom, "old-action")).toEqual({
      previousActionId: "old-action",
      recovered: false,
    });
    expect(JSON.stringify(currentRoom.game)).toBe(before);
  });

  it("forfeits an unselected seer check without revealing a result", () => {
    const currentRoom = room();
    const game = currentRoom.game!;
    game.phase = "night_seer";
    game.actionId = "seer-action";
    game.wolfTargetId = "p5";
    delete game.seerTargetId;
    game.seerResultConfirmed = false;

    expect(recoverTimedOutWerewolfInteraction(currentRoom, "seer-action").recovered).toBe(true);
    expect(game.seerTargetId).toBeUndefined();
    expect(game.seerResultConfirmed).toBe(false);
    expect(game.deadPlayerIds).toContain("p5");
    expect(game.phase).toBe("night_complete");
  });

  it("auto-confirms a seer result that was already shown before timeout", () => {
    const currentRoom = room();
    const game = currentRoom.game!;
    game.phase = "night_seer";
    game.actionId = "seer-result-action";
    game.seerTargetId = "p2";
    game.seerResultConfirmed = false;

    expect(recoverTimedOutWerewolfInteraction(currentRoom, "seer-result-action").recovered).toBe(true);
    expect(game.seerTargetId).toBe("p2");
    expect(game.seerResultConfirmed).toBe(true);
    expect(game.phase).toBe("night_complete");
  });

  it("turns a night-triggered hunter timeout into no shot", () => {
    const currentRoom = room();
    const game = currentRoom.game!;
    game.roles = {
      p1: "hunter",
      p2: "werewolf",
      p3: "witch",
      p4: "seer",
      p5: "villager",
    };
    game.deadPlayerIds = ["p1"];
    game.phase = "day_hunter";
    game.actionId = "hunter-action";
    game.hunterTrigger = "night";

    expect(recoverTimedOutWerewolfInteraction(currentRoom, "hunter-action").recovered).toBe(true);
    expect(game.hunterExecutionTargetId).toBeUndefined();
    expect(game.hunterTrigger).toBeUndefined();
    expect(game.phase).toBe("night_complete");
  });
});
