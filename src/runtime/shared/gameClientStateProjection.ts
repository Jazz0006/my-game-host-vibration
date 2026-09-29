import {
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import { isGameType } from "../../games/GameCatalog.js";
import {
  botcGameModule,
  type BotcGameConfig,
  type BotcGameState,
} from "../../games/botc/BotcGameModule.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import {
  botcGameViewContext,
  createBotcClientRoomProjection,
} from "./botcClientRoomProjection.js";
import { createWerewolfClientRoomProjection } from "./werewolfClientRoomProjection.js";
import { werewolfPlayerGameView } from "./werewolfRoomView.js";

type BotcSnapshot = RoomSnapshot<
  BotcGameState,
  BotcGameConfig,
  unknown,
  unknown,
  unknown
>;

type WerewolfSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  unknown
>;

function assertKnownGameType(snapshot: RoomSnapshot): "werewolf" | "botc" {
  const gameType = snapshot.metadata.gameType;
  if (!isGameType(gameType)) {
    throw new Error(`unsupported game type: ${gameType}`);
  }
  return gameType;
}

/**
 * Game-dispatched client projection seam.
 *
 * Shared transport/runtime code calls only these functions. Concrete game view
 * logic remains in per-game projection owners; this seam only selects the
 * game-specific projector for the snapshot's fixed gameType.
 */
export function createGamePlayerStateEnvelope(
  snapshot: RoomSnapshot,
  playerId: string,
) {
  const gameType = assertKnownGameType(snapshot);

  if (gameType === "werewolf") {
    const restored = restoreRoomSnapshot(snapshot as WerewolfSnapshot);
    if (!restored.room.players.some(player => player.id === playerId)) {
      throw new Error("player is not a room member");
    }
    return createPlayerStateEnvelope(
      restored.room.id,
      playerId,
      werewolfPlayerGameView(restored.room, playerId),
    );
  }

  const restored = restoreRoomSnapshot(snapshot as BotcSnapshot);
  if (!restored.room.players.some(player => player.id === playerId)) {
    throw new Error("player is not a room member");
  }
  return createPlayerStateEnvelope(
    restored.room.id,
    playerId,
    restored.room.game
      ? botcGameModule.getPlayerView(
          restored.room.game,
          playerId,
          botcGameViewContext(restored.room),
        )
      : { phase: "lobby", mode: "lobby" },
  );
}

export function createGameRoomStateEnvelope(
  snapshot: RoomSnapshot,
  playerId: string,
  isPlayerConnected: (playerId: string) => boolean,
) {
  const gameType = assertKnownGameType(snapshot);

  if (gameType === "werewolf") {
    const restored = restoreRoomSnapshot(snapshot as WerewolfSnapshot);
    return createRoomStateEnvelope(
      restored.room.id,
      createWerewolfClientRoomProjection(
        restored.room,
        playerId,
        { isPlayerConnected },
      ),
    );
  }

  const restored = restoreRoomSnapshot(snapshot as BotcSnapshot);
  return createRoomStateEnvelope(
    restored.room.id,
    createBotcClientRoomProjection(
      restored.room,
      playerId,
      { isPlayerConnected },
    ),
  );
}
