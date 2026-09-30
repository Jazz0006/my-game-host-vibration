import {
  gameParticipantPlayers,
  isHumanGameModerator,
} from "../../core/room/GameModerator.js";
import type {
  RoomPlayer,
  RoomState,
} from "../../core/room/types.js";
import type {
  GameViewContext,
} from "../../core/game/GameModule.js";
import {
  botcGameModule,
  type BotcGameConfig,
  type BotcGameState,
} from "../../games/botc/BotcGameModule.js";
import {
  TROUBLE_BREWING_ROLES,
  TROUBLE_BREWING_SCRIPT_ID,
} from "../../games/botc/TroubleBrewing.js";
import type {
  BotcClientRoomProjection,
} from "../../protocol/client/BotcRoomClientProjection.js";

export type BotcClientRoomProjectionOptions = {
  isPlayerConnected(playerId: string): boolean;
};

export function botcGameViewContext<
  TPlayer extends RoomPlayer,
>(
  room: RoomState<BotcGameState, BotcGameConfig, TPlayer>,
): GameViewContext {
  return {
    players: gameParticipantPlayers(room).map(({ id, name, seat }) => ({
      id,
      name,
      seat,
    })),
  };
}

export function createBotcClientRoomProjection<
  TPlayer extends RoomPlayer,
>(
  room: RoomState<BotcGameState, BotcGameConfig, TPlayer>,
  viewerPlayerId: string,
  options: BotcClientRoomProjectionOptions,
): BotcClientRoomProjection {
  const viewer = room.players.find(player => player.id === viewerPlayerId);
  if (!viewer) throw new Error("viewer is not a room member");

  const players = room.players.map(player => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    isHost: player.isHost,
    ready: Boolean(player.ready),
    connected: options.isPlayerConnected(player.id),
  }));
  const base = {
    roomId: room.id,
    gameType: room.gameType,
    viewer: {
      playerId: viewer.id,
      isHost: viewer.isHost,
      isGameModerator: isHumanGameModerator(room.gameModerator, viewer.id),
    },
    gameModerator: { ...room.gameModerator },
    players,
  };

  if (!room.game) {
    const participants = gameParticipantPlayers(room);
    return {
      ...base,
      gameStarted: false,
      lobbySetup: {
        canStart:
          participants.length >= 5 &&
          participants.length <= 15 &&
          participants.every(player => options.isPlayerConnected(player.id)),
        minPlayers: 5,
        maxPlayers: 15,
        scriptId: TROUBLE_BREWING_SCRIPT_ID,
        roleCatalog: TROUBLE_BREWING_ROLES.map(role => ({ ...role })),
      },
    };
  }

  const context = botcGameViewContext(room);
  return {
    ...base,
    gameStarted: true,
    game: isHumanGameModerator(room.gameModerator, viewer.id)
      ? botcGameModule.getModeratorView(room.game, context)
      : botcGameModule.getPublicView(room.game, context),
  };
}
