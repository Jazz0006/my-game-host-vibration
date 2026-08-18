import { describe, expect, it } from "vitest";
import { parseCommandEnvelope } from "../src/core/command/CommandEnvelope.js";
import { configFromPlayerCount } from "../src/domain/game.js";
import type { WerewolfCommand } from "../src/games/werewolf/WerewolfGameModule.js";
import {
  createWerewolfGame,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";
import {
  runPlayerCommand,
  runPlayerCommandIdempotent,
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

describe("C3 transport envelope to runtime", () => {
  it("keeps commandId outside the Werewolf command and dedupes a delivered retry", async () => {
    const currentRoom = room();
    const game = createWerewolfGame(currentRoom, currentRoom.gameConfig);
    const actionId = game.actionId;

    for (const playerId of ["p1", "p2", "p3", "p4"]) {
      runPlayerCommand(currentRoom, playerId, { type: "confirmRole", actionId });
    }

    const wirePayload = {
      commandId: "transport-1",
      command: { type: "confirmRole", actionId },
    };
    const envelope = parseCommandEnvelope(wirePayload, value => value as WerewolfCommand);

    expect(envelope.command).not.toHaveProperty("commandId");

    const first = await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      envelope.commandId,
      envelope.command,
    );
    const retry = await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      envelope.commandId,
      envelope.command,
    );

    expect(first.replayed).toBe(false);
    expect(retry).toEqual({ outcome: first.outcome, replayed: true });
    expect(currentRoom.commandReceipts).toEqual([
      { commandId: "player:p5:transport-1", result: first.outcome },
    ]);
  });
});
