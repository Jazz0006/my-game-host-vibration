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

  it("keeps Werewolf runtime ownership concrete while BotC is admission-only before B0", () => {
    const werewolf = gameAdmission("werewolf");
    const botc = gameAdmission("botc");

    expect(werewolf.gameType).toBe("werewolf");
    expect(werewolf.maxPlayers).toBeGreaterThan(0);
    expect(werewolf.createInitialGameConfig()).toMatchObject({
      playerCount: expect.any(Number),
      roleDeck: expect.any(Array),
    });
    expect(gameModuleFor("werewolf")).toBeDefined();

    expect(botc.gameType).toBe("botc");
    expect(botc.maxPlayers).toBeGreaterThan(0);
    expect(botc.createInitialGameConfig()).toEqual({});
    expect(gameModuleFor("botc")).toBeUndefined();
  });
});
