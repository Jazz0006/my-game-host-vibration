import type { GameViewContext } from "../../core/game/GameModule.js";
import { interactionForPlayer } from "../../core/interaction/PendingInteraction.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import { werewolfGameModule } from "../../games/werewolf/WerewolfGameModule.js";
import {
  getActiveWerewolfInteraction,
  type WerewolfInteraction,
} from "../../games/werewolf/WerewolfNightPlanner.js";

export function werewolfGameViewContext<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
): GameViewContext {
  return {
    players: room.players.map(({ id, name, seat }) => ({ id, name, seat })),
  };
}

export function activeWerewolfInteraction<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
): WerewolfInteraction | undefined {
  return room.game ? getActiveWerewolfInteraction(room.game) : undefined;
}

/**
 * E1 platform-neutral private player projection. Web/Node, Cloudflare, WeChat,
 * and future clients must receive the same view for the same stable playerId
 * and authoritative room state.
 */
export function werewolfPlayerGameView<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
  playerId: string,
): unknown {
  if (!room.game) return { phase: "lobby", mode: "lobby" };

  const view = werewolfGameModule.getPlayerView(
    room.game,
    playerId,
    werewolfGameViewContext(room),
  );
  const playerInteraction = interactionForPlayer(
    activeWerewolfInteraction(room),
    playerId,
  );
  return playerInteraction
    ? { ...view, activeInteraction: playerInteraction }
    : view;
}

export function werewolfActingPlayerIds<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
): string[] {
  if (!room.game) return [];
  const interaction = activeWerewolfInteraction(room);
  return interaction?.actorPlayerIds ?? werewolfGameModule.getActingPlayerIds(room.game);
}
