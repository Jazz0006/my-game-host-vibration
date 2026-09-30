export type GameModeratorAssignment =
  | { mode: "automatic" }
  | { mode: "human"; playerId: string };

export type RoomPlayer = {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  ready?: boolean;
  resumeTokenHash: string;
};

export type RoomState<
  TGameState = unknown,
  TGameConfig = unknown,
  TPlayer extends RoomPlayer = RoomPlayer,
> = {
  id: string;
  gameType: string;
  players: TPlayer[];
  createdAt: number;
  updatedAt: number;
  gameModerator: GameModeratorAssignment;
  gameConfig: TGameConfig;
  game?: TGameState;
};

export type PublicRoomPlayer = Pick<RoomPlayer, "id" | "name" | "seat" | "isHost" | "ready">;
