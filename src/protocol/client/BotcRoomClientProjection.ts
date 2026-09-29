import type {
  BotcModeratorView,
  BotcPublicView,
} from "../../games/botc/BotcGameModule.js";
import type {
  TroubleBrewingRoleId,
} from "../../games/botc/TroubleBrewing.js";
import type {
  ClientRoomProjection,
  ClientRoomProjectionPlayer,
} from "./ClientRoomProjection.js";

export type BotcConnectedRoomPlayer = ClientRoomProjectionPlayer & {
  connected: boolean;
};

export type BotcLobbySetupProjection = {
  canStart: boolean;
  minPlayers: number;
  maxPlayers: number;
  scriptId: "trouble-brewing";
  roleCatalog: Array<{
    id: TroubleBrewingRoleId;
    name: string;
    nameZh: string;
    category: "townsfolk" | "outsider" | "minion" | "demon";
  }>;
};

export type BotcRoomGameProjection = BotcPublicView | BotcModeratorView;

export type BotcClientRoomProjection = Omit<
  ClientRoomProjection,
  "players"
> & {
  players: BotcConnectedRoomPlayer[];
  lobbySetup?: BotcLobbySetupProjection;
  game?: BotcRoomGameProjection;
};
