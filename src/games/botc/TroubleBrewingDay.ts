import type { BotcGameState } from "./BotcGameModule.js";

export type BotcDayCommand =
  | { type: "nominate"; playerId: string }
  | { type: "vote"; approve: boolean }
  | { type: "finishVote" }
  | { type: "closeDay" };
export type BotcDayState = {
  nominators: string[];
  nominees: string[];
  ballot?: { nominatorPlayerId: string; nomineePlayerId: string; votes: Record<string, boolean> };
  tallies: Array<{ nomineePlayerId: string; voteCount: number; threshold: number }>;
  closed: boolean;
  executionPlayerId?: string;
  executionDied?: boolean;
};
export function createTroubleBrewingDay(): BotcDayState {
  return { nominators: [], nominees: [], tallies: [], closed: false };
}

/** Concrete TB nomination/vote rules; returns a plan for the Session commit. */
export function resolveTroubleBrewingDay(
  state: BotcGameState,
  actorPlayerId: string | undefined,
  isModerator: boolean,
  command: BotcDayCommand,
): { day: BotcDayState; ghostVoteSpentPlayerIds: string[] } {
  if (state.phase !== "day") throw new Error("BotC day action requires daytime");
  const day = structuredClone(state.day ?? createTroubleBrewingDay());
  if (day.closed) throw new Error("BotC day is already closed");
  const ids = state.seatingPlayerIds;
  const alive = ids.filter(id => !state.deadPlayerIds.includes(id));
  const spent = [...state.ghostVoteSpentPlayerIds];
  if (command.type === "nominate") {
    if (!actorPlayerId || !alive.includes(actorPlayerId)) throw new Error("Only a living player can nominate");
    if (day.ballot) throw new Error("Finish the active vote before another nomination");
    if (!ids.includes(command.playerId)) throw new Error("Nominee is not a participant");
    if (day.nominators.includes(actorPlayerId) || day.nominees.includes(command.playerId)) {
      throw new Error("Each player may nominate and be nominated only once per day");
    }
    day.nominators.push(actorPlayerId);
    day.nominees.push(command.playerId);
    day.ballot = { nominatorPlayerId: actorPlayerId, nomineePlayerId: command.playerId, votes: {} };
  } else if (command.type === "vote") {
    if (!day.ballot) throw new Error("There is no active BotC vote");
    if (!actorPlayerId || !ids.includes(actorPlayerId)) throw new Error("Only participants can vote");
    if (!alive.includes(actorPlayerId) && spent.includes(actorPlayerId)) throw new Error("Ghost vote is already spent");
    if (actorPlayerId in day.ballot.votes) throw new Error("Vote has already been submitted");
    day.ballot.votes[actorPlayerId] = command.approve;
  } else if (command.type === "finishVote") {
    if (!isModerator) throw new Error("Only the moderator controller can finish voting");
    if (!day.ballot) throw new Error("There is no active BotC vote");
    const votes = day.ballot.votes;
    const butler = state.assignments.find(item => item.actualRoleId === "butler");
    const counted = ids.filter(id => {
      if (!votes[id] || (!alive.includes(id) && spent.includes(id))) return false;
      return !(butler?.playerId === id && alive.includes(id) && state.poisonedPlayerId !== id &&
        state.butlerMasterPlayerId && !votes[state.butlerMasterPlayerId]);
    });
    for (const id of counted) if (!alive.includes(id)) spent.push(id);
    day.tallies.push({ nomineePlayerId: day.ballot.nomineePlayerId,
      voteCount: counted.length, threshold: Math.ceil(alive.length / 2) });
    delete day.ballot;
  } else {
    if (!isModerator) throw new Error("Only the moderator controller can close the day");
    if (day.ballot) throw new Error("Finish voting before closing the day");
    const eligible = day.tallies.filter(item => item.voteCount >= item.threshold);
    const highest = Math.max(0, ...eligible.map(item => item.voteCount));
    const leaders = eligible.filter(item => item.voteCount === highest);
    if (leaders.length === 1) day.executionPlayerId = leaders[0]!.nomineePlayerId;
    day.closed = true;
  }
  return { day, ghostVoteSpentPlayerIds: spent };
}
