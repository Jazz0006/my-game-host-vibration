import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";

export type BotcDayVoteChoice = boolean;

export type BotcActiveNomination = {
  id: string;
  nominatorPlayerId: string;
  nomineePlayerId: string;
  votesByPlayerId: Record<string, BotcDayVoteChoice>;
};

export type BotcClosedNomination = {
  id: string;
  nominatorPlayerId: string;
  nomineePlayerId: string;
  yesVoterPlayerIds: string[];
  voteCount: number;
  threshold: number;
  result: "below_threshold" | "below_high" | "new_high" | "tied_high";
};

export type BotcDayVotingState = {
  dayNumber: number;
  nominationSequence: number;
  usedNominatorPlayerIds: string[];
  usedNomineePlayerIds: string[];
  spentGhostVotePlayerIds: string[];
  highVoteCount: number;
  tiedAtHigh: boolean;
  blockNomineePlayerId?: string;
  activeNomination?: BotcActiveNomination;
  lastClosedNomination?: BotcClosedNomination;
};

export type BotcDayVotingFacts = {
  seatingPlayerIds: readonly string[];
  deadPlayerIds: readonly string[];
  assignments: readonly BotcCanonicalSetupAssignment[];
  poisonedPlayerId?: string;
  butlerMasterPlayerId?: string;
};

export type BotcDayVotingPublicView = {
  dayNumber: number;
  aliveCount: number;
  threshold: number;
  usedNominatorPlayerIds: string[];
  usedNomineePlayerIds: string[];
  spentGhostVotePlayerIds: string[];
  highVoteCount: number;
  tiedAtHigh: boolean;
  blockNomineePlayerId?: string;
  activeNomination?: {
    id: string;
    nominatorPlayerId: string;
    nomineePlayerId: string;
    yesVoterPlayerIds: string[];
  };
  lastClosedNomination?: BotcClosedNomination;
};

function uniquePush(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function requireSeated(facts: BotcDayVotingFacts, playerId: string): void {
  if (!facts.seatingPlayerIds.includes(playerId)) {
    throw new Error("BotC day action requires a seated player");
  }
}

function aliveCount(facts: BotcDayVotingFacts): number {
  const dead = new Set(facts.deadPlayerIds);
  return facts.seatingPlayerIds.filter(playerId => !dead.has(playerId)).length;
}

export function botcDayVoteThreshold(facts: BotcDayVotingFacts): number {
  return Math.ceil(aliveCount(facts) / 2);
}

export function startBotcDayVotingDay(
  previous: BotcDayVotingState | undefined,
  dayNumber: number,
): BotcDayVotingState {
  if (!Number.isSafeInteger(dayNumber) || dayNumber <= 0) {
    throw new Error("BotC day number must be a positive safe integer");
  }

  return {
    dayNumber,
    nominationSequence: 0,
    usedNominatorPlayerIds: [],
    usedNomineePlayerIds: [],
    spentGhostVotePlayerIds: previous
      ? [...previous.spentGhostVotePlayerIds]
      : [],
    highVoteCount: 0,
    tiedAtHigh: false,
  };
}

export function startBotcNomination(
  state: BotcDayVotingState,
  facts: BotcDayVotingFacts,
  nominatorPlayerId: string,
  nomineePlayerId: string,
): BotcActiveNomination {
  if (state.activeNomination) {
    throw new Error("A BotC nomination is already active");
  }
  requireSeated(facts, nominatorPlayerId);
  requireSeated(facts, nomineePlayerId);
  if (facts.deadPlayerIds.includes(nominatorPlayerId)) {
    throw new Error("Dead BotC players cannot nominate");
  }
  if (state.usedNominatorPlayerIds.includes(nominatorPlayerId)) {
    throw new Error("This BotC player has already nominated today");
  }
  if (state.usedNomineePlayerIds.includes(nomineePlayerId)) {
    throw new Error("This BotC player has already been nominated today");
  }

  state.nominationSequence += 1;
  uniquePush(state.usedNominatorPlayerIds, nominatorPlayerId);
  uniquePush(state.usedNomineePlayerIds, nomineePlayerId);
  const nomination: BotcActiveNomination = {
    id: `day-${state.dayNumber}-nomination-${state.nominationSequence}`,
    nominatorPlayerId,
    nomineePlayerId,
    votesByPlayerId: {},
  };
  state.activeNomination = nomination;
  return nomination;
}

export function submitBotcDayVote(
  state: BotcDayVotingState,
  facts: BotcDayVotingFacts,
  voterPlayerId: string,
  vote: BotcDayVoteChoice,
): BotcActiveNomination {
  const nomination = state.activeNomination;
  if (!nomination) throw new Error("There is no active BotC nomination");
  requireSeated(facts, voterPlayerId);

  if (
    vote &&
    facts.deadPlayerIds.includes(voterPlayerId) &&
    state.spentGhostVotePlayerIds.includes(voterPlayerId)
  ) {
    throw new Error("This dead BotC player has already spent their ghost vote");
  }

  nomination.votesByPlayerId[voterPlayerId] = vote;
  return nomination;
}

function assertButlerVoteLegal(
  state: BotcDayVotingState,
  facts: BotcDayVotingFacts,
): void {
  const nomination = state.activeNomination;
  if (!nomination || !facts.butlerMasterPlayerId) return;

  const butler = facts.assignments.find(
    assignment => assignment.actualRoleId === "butler",
  );
  if (
    !butler ||
    facts.deadPlayerIds.includes(butler.playerId) ||
    facts.poisonedPlayerId === butler.playerId ||
    nomination.votesByPlayerId[butler.playerId] !== true
  ) {
    return;
  }

  if (nomination.votesByPlayerId[facts.butlerMasterPlayerId] !== true) {
    throw new Error("BotC voting constraints are not satisfied");
  }
}

export function closeBotcNomination(
  state: BotcDayVotingState,
  facts: BotcDayVotingFacts,
): BotcClosedNomination {
  const nomination = state.activeNomination;
  if (!nomination) throw new Error("There is no active BotC nomination");

  assertButlerVoteLegal(state, facts);

  const yesVoterPlayerIds = facts.seatingPlayerIds.filter(
    playerId => nomination.votesByPlayerId[playerId] === true,
  );
  for (const playerId of yesVoterPlayerIds) {
    if (facts.deadPlayerIds.includes(playerId)) {
      uniquePush(state.spentGhostVotePlayerIds, playerId);
    }
  }

  const voteCount = yesVoterPlayerIds.length;
  const threshold = botcDayVoteThreshold(facts);
  let result: BotcClosedNomination["result"];

  if (voteCount < threshold) {
    result = "below_threshold";
  } else if (voteCount < state.highVoteCount) {
    result = "below_high";
  } else if (voteCount === state.highVoteCount && state.highVoteCount > 0) {
    result = "tied_high";
    state.tiedAtHigh = true;
    delete state.blockNomineePlayerId;
  } else {
    result = "new_high";
    state.highVoteCount = voteCount;
    state.tiedAtHigh = false;
    state.blockNomineePlayerId = nomination.nomineePlayerId;
  }

  const closed: BotcClosedNomination = {
    id: nomination.id,
    nominatorPlayerId: nomination.nominatorPlayerId,
    nomineePlayerId: nomination.nomineePlayerId,
    yesVoterPlayerIds,
    voteCount,
    threshold,
    result,
  };
  state.lastClosedNomination = closed;
  delete state.activeNomination;
  return closed;
}

export function createBotcDayVotingPublicView(
  state: BotcDayVotingState,
  facts: BotcDayVotingFacts,
): BotcDayVotingPublicView {
  const active = state.activeNomination;
  return {
    dayNumber: state.dayNumber,
    aliveCount: aliveCount(facts),
    threshold: botcDayVoteThreshold(facts),
    usedNominatorPlayerIds: [...state.usedNominatorPlayerIds],
    usedNomineePlayerIds: [...state.usedNomineePlayerIds],
    spentGhostVotePlayerIds: [...state.spentGhostVotePlayerIds],
    highVoteCount: state.highVoteCount,
    tiedAtHigh: state.tiedAtHigh,
    ...(state.blockNomineePlayerId
      ? { blockNomineePlayerId: state.blockNomineePlayerId }
      : {}),
    ...(active
      ? {
          activeNomination: {
            id: active.id,
            nominatorPlayerId: active.nominatorPlayerId,
            nomineePlayerId: active.nomineePlayerId,
            yesVoterPlayerIds: facts.seatingPlayerIds.filter(
              playerId => active.votesByPlayerId[playerId] === true,
            ),
          },
        }
      : {}),
    ...(state.lastClosedNomination
      ? {
          lastClosedNomination: {
            ...state.lastClosedNomination,
            yesVoterPlayerIds: [...state.lastClosedNomination.yesVoterPlayerIds],
          },
        }
      : {}),
  };
}
