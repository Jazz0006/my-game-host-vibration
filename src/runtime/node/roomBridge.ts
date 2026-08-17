import { RoomCore } from "../../core/room/RoomCore.js";
import type { GameViewContext } from "../../core/game/GameModule.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import type { TestPrompt } from "../../domain/testPrompt.js";
import { werewolfGameModule } from "../../games/werewolf/WerewolfGameModule.js";

export type RuntimePlayer = RoomPlayer & {
  socketId: string | null;
  connected: boolean;
};

export type RuntimeRoom = RoomState<GameState, GameConfig, RuntimePlayer> & {
  activePrompt?: TestPrompt;
};

export function roomCore(room: RuntimeRoom): RoomCore<GameState, GameConfig, RuntimePlayer> {
  return new RoomCore(room);
}

export function gameViewContext(room: RuntimeRoom): GameViewContext {
  return {
    players: room.players.map(({ id, name, seat }) => ({ id, name, seat })),
  };
}

export function playerGameView(room: RuntimeRoom, playerId: string): unknown {
  if (!room.game) return { phase: "lobby", mode: "lobby" };
  return werewolfGameModule.getPlayerView(room.game, playerId, gameViewContext(room));
}

export function hostGameView(room: RuntimeRoom): unknown {
  if (!room.game) return undefined;
  return werewolfGameModule.getHostView(room.game, gameViewContext(room));
}

export function createWerewolfGame(room: RuntimeRoom, config: GameConfig): GameState {
  room.gameType = werewolfGameModule.type;
  room.gameConfig = config;
  room.game = werewolfGameModule.createGame(
    { playerIds: room.players.map(player => player.id), config },
    {
      random: {
        randomInt(maxExclusive: number) {
          return Math.floor(Math.random() * maxExclusive);
        },
        randomId() {
          return crypto.randomUUID();
        },
      },
    },
  );
  room.updatedAt = Date.now();
  return room.game;
}
