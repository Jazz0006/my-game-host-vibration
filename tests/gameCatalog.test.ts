import { describe, expect, it } from "vitest";
import {
  GAME_TYPES,
  gameAdmission,
  gameModuleFor,
  isGameType,
} from "../src/games/GameCatalog.js";

describe("MG0A GameCatalog admission seam", () => {
  it("admits exactly the current product game types", () => {
    expect(GAME_TYPES).toEqual(["werewolf", "botc"]);
    expect(isGameType("werewolf")).toBe(true);
    expect(isGameType("botc")).toBe(true);
    expect(isGameType("unknown")).toBe(false);
    expect(isGameType(undefined)).toBe(false);
  });

  it("registers concrete game modules and initial config for both product games", () => {
    const werewolf = gameAdmission("werewolf");
    const botc = gameAdmission("botc");

    expect(werewolf.gameType).toBe("werewolf");
    expect(werewolf.maxPlayers).toBeGreaterThan(0);
    expect(werewolf.createInitialGameConfig()).toMatchObject({
      playerCount: expect.any(Number),
      roleDeck: expect.any(Array),
    });
    expect(gameModuleFor("werewolf")?.type).toBe("werewolf");

    expect(botc.gameType).toBe("botc");
    expect(botc.maxPlayers).toBe(15);
    expect(botc.createInitialGameConfig()).toEqual({
      scriptId: "trouble-brewing",
    });
    expect(gameModuleFor("botc")?.type).toBe("botc");
  });
});
