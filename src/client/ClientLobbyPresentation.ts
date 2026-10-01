type UnknownRecord = Record<string, unknown>;

export type ClientLobbyParticipant = {
  id: string;
  name: string;
  seat: number;
  isOwner: boolean;
  ready: boolean;
  connected: boolean;
};

export type ClientLobbyPresentation = {
  roomCode: string;
  gameType: string;
  participants: ClientLobbyParticipant[];
  playerOrder: string[];
  currentPlayerId: string;
  ownerId: string;
  moderatorAssignment:
    | { mode: "automatic" }
    | { mode: "human"; playerId: string };
  moderatorName: string;
  isOwner: boolean;
  isGameModerator: boolean;
  canControlGame: boolean;
  gameStarted: boolean;
  currentPlayerReady: boolean;
  canInvite: boolean;
  canStartGame: boolean;
  canToggleReady: boolean;
  canManageRoom: boolean;
  statusLine: string;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function moderatorAssignment(value: unknown): ClientLobbyPresentation["moderatorAssignment"] {
  const record = asRecord(value);
  const playerId = asString(record?.playerId);
  return asString(record?.mode) === "human" && playerId
    ? { mode: "human", playerId }
    : { mode: "automatic" };
}

export function createClientLobbyPresentation(
  roomValue: unknown,
): ClientLobbyPresentation {
  const room = asRecord(roomValue);
  const rawPlayers = room && Array.isArray(room.players) ? room.players : [];
  const players = rawPlayers
    .map(asRecord)
    .filter((player): player is UnknownRecord => player !== null)
    .map(player => ({
      id: asString(player.id),
      name: asString(player.name),
      seat: asNumber(player.seat),
      isOwner: Boolean(player.isHost),
      ready: Boolean(player.ready),
      connected: player.connected !== false,
    }))
    .sort((left, right) => left.seat - right.seat);

  const owner = players.find(player => player.isOwner);
  const assignment = moderatorAssignment(room?.gameModerator);
  const moderatorPlayerId =
    assignment.mode === "human" ? assignment.playerId : "";
  const moderator = players.find(player => player.id === moderatorPlayerId);
  const viewer = asRecord(room?.viewer);
  const currentPlayerId = asString(viewer?.playerId);
  const currentPlayer = players.find(player => player.id === currentPlayerId);
  const isOwner = Boolean(viewer?.isHost);
  const isGameModerator = Boolean(viewer?.isGameModerator);
  const canControlGame =
    assignment.mode === "human" ? isGameModerator : isOwner;
  const gameStarted = Boolean(room?.gameStarted);

  return {
    roomCode: asString(room?.roomId),
    gameType: asString(room?.gameType),
    participants: players,
    playerOrder: players
      .filter(player => player.id !== moderatorPlayerId)
      .map(player => player.id),
    currentPlayerId,
    ownerId: owner?.id ?? "",
    moderatorAssignment: assignment,
    moderatorName: moderator?.name ?? "自动",
    isOwner,
    isGameModerator,
    canControlGame,
    gameStarted,
    currentPlayerReady: Boolean(currentPlayer?.ready),
    canInvite: isOwner && !gameStarted,
    canStartGame: canControlGame && !gameStarted,
    canToggleReady: !isGameModerator && !gameStarted,
    canManageRoom: isOwner,
    statusLine: gameStarted
      ? "服务器已开始游戏，authoritative PlayerView 已切换到游戏状态。"
      : "已连接 authoritative room projection。",
  };
}
