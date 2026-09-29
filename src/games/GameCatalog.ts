import type { GameModule } from "../core/game/GameModule.js";
import { botcGameModule } from "./botc/BotcGameModule.js";
import { TROUBLE_BREWING_SCRIPT_ID } from "./botc/TroubleBrewing.js";
import { DEFAULT_GAME_CONFIG } from "./werewolf/WerewolfDomainFacade.js";
import { werewolfGameModule } from "./werewolf/WerewolfGameModule.js";
import { WEREWOLF_MAX_PLAYERS } from "./werewolf/WerewolfLobbyPolicy.js";

export const GAME_TYPES = ["werewolf", "botc"] as const;
export type GameType = typeof GAME_TYPES[number];

export type GameAdmissionDefinition = {
  gameType: GameType;
  maxPlayers: number;
  createInitialGameConfig(): unknown;
  gameModule?: GameModule<unknown, unknown, unknown, unknown, unknown, unknown, unknown>;
};

const definitions: Record<GameType, GameAdmissionDefinition> = {
  werewolf: {
    gameType: "werewolf",
    maxPlayers: WEREWOLF_MAX_PLAYERS,
    createInitialGameConfig: () => ({
      ...DEFAULT_GAME_CONFIG,
      roleDeck: [...DEFAULT_GAME_CONFIG.roleDeck],
    }),
    gameModule: werewolfGameModule as unknown as GameModule<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >,
  },
  botc: {
    gameType: "botc",
    maxPlayers: 15,
    createInitialGameConfig: () => ({ scriptId: TROUBLE_BREWING_SCRIPT_ID }),
    gameModule: botcGameModule as unknown as GameModule<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >,
  },
};

/** Product admission catalog. Concrete game semantics remain game-owned. */
export function isGameType(value: unknown): value is GameType {
  return typeof value === "string" &&
    (GAME_TYPES as readonly string[]).includes(value);
}

export function gameAdmission(gameType: GameType): GameAdmissionDefinition {
  return definitions[gameType];
}

export function gameModuleFor(gameType: GameType): GameAdmissionDefinition["gameModule"] {
  return definitions[gameType].gameModule;
}
