import {
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import { isGameType } from "../../games/GameCatalog.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import { createClientRoomProjection } from "./clientRoomProjection.js";
import { createWerewolfClientRoomProjection } from "./werewolfClientRoomProjection.js";
import { werewolfPlayerGameView } from "./werewolfRoomView.js";

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

function assertLobbyOnly(snapshot: RoomSnapshot, gameType: "botc"): void {
  if (snapshot.game !== undefined) {
    throw new Error(`${gameType} gameplay runtime is not available`);
  }
}

/**
 * Game-dispatched client projection seam.
 *
 * Shared transport/runtime code calls only these functions. Concrete game view
 * logic remains in per-game projection owners; BotC is intentionally lobby-only
 * until its B0 runtime exists.
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

  assertLobbyOnly(snapshot, gameType);
  const restored = restoreRoomSnapshot(snapshot);
  if (!restored.room.players.some(player => player.id === playerId)) {
    throw new Error("player is not a room member");
  }
  return createPlayerStateEnvelope(
    restored.room.id,
    playerId,
    { phase: "lobby", mode: "lobby" },
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

  assertLobbyOnly(snapshot, gameType);
  const restored = restoreRoomSnapshot(snapshot);
  return createRoomStateEnvelope(
    restored.room.id,
    createClientRoomProjection(restored.room, playerId),
  );
}
