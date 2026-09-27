export type ClientRoomProjectionPlayer = {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
};

export type ClientRoomProjection = {
  roomId: string;
  gameType: string;
  viewer: {
    playerId: string;
    isHost: boolean;
  };
  players: ClientRoomProjectionPlayer[];
  gameStarted: boolean;
};
