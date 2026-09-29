import type { Role } from "../../../domain/game.js";
import type {
  WerewolfModeratorView,
  WerewolfPublicView,
} from "../../../games/werewolf/WerewolfGameModule.js";
import type {
  ClientRoomProjection,
  ClientRoomProjectionPlayer,
} from "../ClientRoomProjection.js";

export type WerewolfConnectedRoomPlayer = ClientRoomProjectionPlayer & {
  connected: boolean;
};

export type WerewolfLobbySetupProjection = {
  canStart: boolean;
  minPlayers: number;
  maxPlayers: number;
  roleCatalog: Array<{
    id: Role;
    name: string;
  }>;
  defaultRoleDeck: Role[];
};

export type WerewolfOwnerRecoveryProjection = {
  hasPendingInteraction: boolean;
  waitingCount: number;
  onlineWaitingCount: number;
  offlineWaitingCount: number;
};

export type WerewolfRoomGameProjection =
  | (WerewolfPublicView & {
      canStart: false;
      minPlayers: number;
      maxPlayers: number;
    })
  | (WerewolfModeratorView & {
      canStart: false;
      minPlayers: number;
      maxPlayers: number;
    });

/**
 * Werewolf-specific public/host room projection layered on top of the generic
 * room membership contract. Secret player information remains in PlayerView.
 */
export type WerewolfClientRoomProjection = Omit<
  ClientRoomProjection,
  "players"
> & {
  players: WerewolfConnectedRoomPlayer[];
  lobbySetup?: WerewolfLobbySetupProjection;
  game?: WerewolfRoomGameProjection;
  recovery?: WerewolfOwnerRecoveryProjection;
};
