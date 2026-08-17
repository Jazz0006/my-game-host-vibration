export type RoomPlayer = {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  resumeTokenHash: string;
};

export type RoomState<
  TGameState = unknown,
  TGameConfig = unknown,
> = {
  id: string;
  gameType: string;
  players: RoomPlayer[];
  createdAt: number;
  updatedAt: number;
  gameConfig: TGameConfig;
  game?: TGameState;
};

export type PublicRoomPlayer = Pick<RoomPlayer, "id" | "name" | "seat" | "isHost">;
