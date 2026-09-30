import {
  gameParticipantPlayers,
  isHumanGameModerator,
} from "../../core/room/GameModerator.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import {
  configFromPlayerCount,
} from "../../games/werewolf/WerewolfDomainFacade.js";
import {
  werewolfGameModule,
} from "../../games/werewolf/WerewolfGameModule.js";
import {
  WEREWOLF_MAX_PLAYERS,
  WEREWOLF_MIN_PLAYERS,
  isWerewolfPlayerCountSupported,
} from "../../games/werewolf/WerewolfLobbyPolicy.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import { werewolfRoleCatalog } from "../../games/werewolf/roles/registry.js";
import type {
  WerewolfClientRoomProjection,
  WerewolfOwnerRecoveryProjection,
} from "../../protocol/client/werewolf/WerewolfRoomClientProjection.js";
import {
  activeWerewolfInteraction,
  werewolfGameViewContext,
} from "./werewolfRoomView.js";

export type WerewolfClientRoomProjectionOptions = {
  isPlayerConnected(playerId: string): boolean;
  pendingInteraction?: WerewolfInteraction;
};

function hostRecoveryProjection<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
  options: WerewolfClientRoomProjectionOptions,
): WerewolfOwnerRecoveryProjection {
  if (!room.game) {
    return {
      hasPendingInteraction: false,
      waitingCount: 0,
      onlineWaitingCount: 0,
      offlineWaitingCount: 0,
    };
  }

  const interaction =
    options.pendingInteraction ?? activeWerewolfInteraction(room);
  const actorIds =
    interaction?.actorPlayerIds ??
    werewolfGameModule.getActingPlayerIds(room.game);
  const onlineWaitingCount = actorIds.filter(playerId =>
    options.isPlayerConnected(playerId)
  ).length;

  return {
    hasPendingInteraction: Boolean(interaction),
    waitingCount: actorIds.length,
    onlineWaitingCount,
    offlineWaitingCount: actorIds.length - onlineWaitingCount,
  };
}

/**
 * Shared Werewolf room/public-host projection used by Node and Cloudflare.
 * Platform connection state is injected; it is never persisted in RoomSnapshot.
 */
export function createWerewolfClientRoomProjection<
  TPlayer extends RoomPlayer,
>(
  room: RoomState<GameState, GameConfig, TPlayer>,
  viewerPlayerId: string,
  options: WerewolfClientRoomProjectionOptions,
): WerewolfClientRoomProjection {
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

  if (!room.game) {
    const participantCount = gameParticipantPlayers(room).length;
    const defaultRoleDeck = isWerewolfPlayerCountSupported(participantCount)
      ? configFromPlayerCount(participantCount).roleDeck
      : room.gameConfig.roleDeck;

    return {
      roomId: room.id,
      gameType: room.gameType,
      viewer: {
        playerId: viewer.id,
        isHost: viewer.isHost,
        isGameModerator: isHumanGameModerator(room.gameModerator, viewer.id),
      },
      gameModerator: { ...room.gameModerator },
      players,
      gameStarted: false,
      lobbySetup: {
        canStart:
          isWerewolfPlayerCountSupported(participantCount) &&
          room.players.every(player =>
            options.isPlayerConnected(player.id)
          ),
        minPlayers: WEREWOLF_MIN_PLAYERS,
        maxPlayers: WEREWOLF_MAX_PLAYERS,
        roleCatalog: werewolfRoleCatalog().map(({ id, name }) => ({ id, name })),
        defaultRoleDeck: [...defaultRoleDeck],
      },
    };
  }

  const context = werewolfGameViewContext(room);
  const common = {
    canStart: false as const,
    minPlayers: WEREWOLF_MIN_PLAYERS,
    maxPlayers: WEREWOLF_MAX_PLAYERS,
  };

  return {
    roomId: room.id,
    gameType: room.gameType,
    viewer: {
      playerId: viewer.id,
      isHost: viewer.isHost,
      isGameModerator: isHumanGameModerator(room.gameModerator, viewer.id),
    },
    gameModerator: { ...room.gameModerator },
    players,
    gameStarted: true,
    game: isHumanGameModerator(room.gameModerator, viewer.id)
      ? {
          ...werewolfGameModule.getModeratorView(room.game, context),
          ...common,
        }
      : {
          ...werewolfGameModule.getPublicView(room.game, context),
          ...common,
        },
    ...(viewer.isHost ? { recovery: hostRecoveryProjection(room, options) } : {}),
  };
}
