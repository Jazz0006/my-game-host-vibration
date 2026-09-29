import type {
  GameModeratorAssignment,
  RoomPlayer,
  RoomState,
} from "./types.js";

export function automaticGameModerator(): GameModeratorAssignment {
  return { mode: "automatic" };
}

export function isHumanGameModerator(
  assignment: GameModeratorAssignment,
  playerId: string,
): boolean {
  return assignment.mode === "human" && assignment.playerId === playerId;
}

/**
 * Automatic mode is system-moderated, so the Room Owner remains the human
 * control surface for lifecycle/phase commands without receiving moderator
 * secret views. Human mode transfers game-control authority to the designated
 * moderator while leaving room-management/recovery authority with the owner.
 */
export function hasGameModeratorControl(
  assignment: GameModeratorAssignment,
  member: Pick<RoomPlayer, "id" | "isHost">,
): boolean {
  return assignment.mode === "human"
    ? assignment.playerId === member.id
    : member.isHost;
}

export function gameParticipantPlayers<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
): TPlayer[] {
  if (room.gameModerator.mode !== "human") return [...room.players];
  const moderatorPlayerId = room.gameModerator.playerId;
  return room.players.filter(player => player.id !== moderatorPlayerId);
}
