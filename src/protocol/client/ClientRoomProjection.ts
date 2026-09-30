import type { GameModeratorAssignment } from "../../core/room/types.js";

export type ClientRoomProjectionPlayer = {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  ready: boolean;
};

export type ClientRoomProjection = {
  roomId: string;
  gameType: string;
  viewer: {
    playerId: string;
    isHost: boolean;
    isGameModerator: boolean;
  };
  gameModerator: GameModeratorAssignment;
  players: ClientRoomProjectionPlayer[];
  gameStarted: boolean;
};
