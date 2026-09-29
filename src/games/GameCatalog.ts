import type { GameModule } from "../core/game/GameModule.js";
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
    // MG0A admits BotC rooms into the shared room platform only. BotC gameplay
    // config/module ownership begins in B0; do not prebuild those rules here.
    maxPlayers: 15,
    createInitialGameConfig: () => ({}),
  },
};

/**
 * Small product admission catalog. It intentionally owns only game selection
 * and room-bootstrap metadata at MG0A; concrete command/projection dispatch
 * moves behind this seam in later MG0 slices.
 */
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
