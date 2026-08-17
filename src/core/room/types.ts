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
  TPrompt = unknown,
> = {
  id: string;
  players: RoomPlayer[];
  createdAt: number;
  config: TGameConfig;
  activePrompt?: TPrompt;
  game?: TGameState;
};

export type PublicRoomPlayer = Pick<RoomPlayer, "id" | "name" | "seat" | "isHost">;
