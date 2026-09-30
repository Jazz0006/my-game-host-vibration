import { isHumanGameModerator } from "../../core/room/GameModerator.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { ClientRoomProjection } from "../../protocol/client/ClientRoomProjection.js";

export function createClientRoomProjection<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
  viewerPlayerId: string,
): ClientRoomProjection {
  const viewer = room.players.find(player => player.id === viewerPlayerId);
  if (!viewer) throw new Error("viewer is not a room member");

  return {
    roomId: room.id,
    gameType: room.gameType,
    viewer: {
      playerId: viewer.id,
      isHost: viewer.isHost,
      isGameModerator: isHumanGameModerator(room.gameModerator, viewer.id),
    },
    gameModerator: { ...room.gameModerator },
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      isHost: player.isHost,
      ready: Boolean(player.ready),
    })),
    gameStarted: room.game !== undefined,
  };
}
