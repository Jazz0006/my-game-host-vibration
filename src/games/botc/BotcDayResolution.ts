import { troubleBrewingRole } from "./TroubleBrewing.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";
import type { TroubleBrewingOtherNightRoleTransition } from "./TroubleBrewingNightSequence.js";

export type BotcWinner = "good" | "evil";

export type BotcGameEndReason =
  | "demon_died"
  | "two_alive"
  | "saint_executed"
  | "mayor_no_execution";

export type BotcDayExecution = {
  playerId: string;
  died: boolean;
  source: "vote" | "virgin";
};

export type BotcDayResolution = {
  dayNumber: number;
  execution?: BotcDayExecution;
  noExecution: boolean;
};

export type BotcDayResolutionFacts = {
  dayNumber: number;
  seatingPlayerIds: readonly string[];
  assignments: readonly BotcCanonicalSetupAssignment[];
  deadPlayerIds: readonly string[];
  poisonedPlayerId?: string;
};

export type BotcExecutionResolution = {
  execution: BotcDayExecution;
  deadPlayerIds: string[];
  roleTransitions: TroubleBrewingOtherNightRoleTransition[];
  winner?: BotcWinner;
  endReason?: BotcGameEndReason;
};

export type BotcNoExecutionResolution = {
  winner?: BotcWinner;
  endReason?: BotcGameEndReason;
};

export type BotcDayResolutionRuntimeState = BotcDayResolutionFacts & {
  roleTransitions: TroubleBrewingOtherNightRoleTransition[];
  dayResolution?: BotcDayResolution;
  executedAndDiedTodayPlayerId?: string;
  winner?: BotcWinner;
  endReason?: BotcGameEndReason;
};

export function createBotcDayResolutionFacts(
  state: BotcDayResolutionRuntimeState,
): BotcDayResolutionFacts {
  return {
    dayNumber: state.dayNumber,
    seatingPlayerIds: state.seatingPlayerIds,
    assignments: state.assignments,
    deadPlayerIds: state.deadPlayerIds,
    ...(state.poisonedPlayerId ? { poisonedPlayerId: state.poisonedPlayerId } : {}),
  };
}

function assignmentFor(
  facts: BotcDayResolutionFacts,
  playerId: string,
): BotcCanonicalSetupAssignment {
  const assignment = facts.assignments.find(item => item.playerId === playerId);
  if (!assignment) throw new Error("BotC day resolution references a non-player");
  return assignment;
}

function aliveCount(
  facts: BotcDayResolutionFacts,
  deadPlayerIds: readonly string[] = facts.deadPlayerIds,
): number {
  const dead = new Set(deadPlayerIds);
  return facts.seatingPlayerIds.filter(playerId => !dead.has(playerId)).length;
}

function isHealthy(
  facts: BotcDayResolutionFacts,
  playerId: string,
): boolean {
  return facts.poisonedPlayerId !== playerId;
}

function aliveHealthyActualRole(
  facts: BotcDayResolutionFacts,
  roleId: BotcCanonicalSetupAssignment["actualRoleId"],
): BotcCanonicalSetupAssignment | undefined {
  return facts.assignments.find(
    assignment =>
      assignment.actualRoleId === roleId &&
      !facts.deadPlayerIds.includes(assignment.playerId) &&
      isHealthy(facts, assignment.playerId),
  );
}

function standardWinnerAfterDeath(
  facts: BotcDayResolutionFacts,
  deadPlayerIds: readonly string[],
): Pick<BotcExecutionResolution, "winner" | "endReason"> {
  if (aliveCount(facts, deadPlayerIds) <= 2) {
    return { winner: "evil", endReason: "two_alive" };
  }
  return {};
}

export function resolveBotcExecution(
  facts: BotcDayResolutionFacts,
  playerId: string,
  source: BotcDayExecution["source"],
): BotcExecutionResolution {
  const assignment = assignmentFor(facts, playerId);
  const wasAlive = !facts.deadPlayerIds.includes(playerId);
  const aliveBefore = aliveCount(facts);
  const deadPlayerIds = [...facts.deadPlayerIds];
  if (wasAlive) deadPlayerIds.push(playerId);

  const execution: BotcDayExecution = {
    playerId,
    died: wasAlive,
    source,
  };
  const roleTransitions: TroubleBrewingOtherNightRoleTransition[] = [];

  if (!wasAlive) {
    return {
      execution,
      deadPlayerIds,
      roleTransitions,
    };
  }

  if (
    assignment.actualRoleId === "saint" &&
    isHealthy(facts, playerId)
  ) {
    return {
      execution,
      deadPlayerIds,
      roleTransitions,
      winner: "evil",
      endReason: "saint_executed",
    };
  }

  if (assignment.actualRoleId === "imp") {
    const scarletWoman = aliveHealthyActualRole(facts, "scarlet_woman");
    if (scarletWoman && aliveBefore >= 5) {
      roleTransitions.push({
        kind: "scarlet_woman_to_imp",
        playerId: scarletWoman.playerId,
      });
      return {
        execution,
        deadPlayerIds,
        roleTransitions,
      };
    }
    return {
      execution,
      deadPlayerIds,
      roleTransitions,
      winner: "good",
      endReason: "demon_died",
    };
  }

  return {
    execution,
    deadPlayerIds,
    roleTransitions,
    ...standardWinnerAfterDeath(facts, deadPlayerIds),
  };
}

export function resolveBotcNoExecution(
  facts: BotcDayResolutionFacts,
): BotcNoExecutionResolution {
  const mayor = aliveHealthyActualRole(facts, "mayor");
  if (mayor && aliveCount(facts) === 3) {
    return {
      winner: "good",
      endReason: "mayor_no_execution",
    };
  }
  if (aliveCount(facts) <= 2) {
    return {
      winner: "evil",
      endReason: "two_alive",
    };
  }
  return {};
}

export function commitBotcExecutionResolution(
  state: BotcDayResolutionRuntimeState,
  playerId: string,
  source: BotcDayExecution["source"],
): BotcDayResolution {
  const resolved = resolveBotcExecution(
    createBotcDayResolutionFacts(state),
    playerId,
    source,
  );
  state.deadPlayerIds = [...resolved.deadPlayerIds];
  state.roleTransitions.push(...resolved.roleTransitions);
  state.dayResolution = {
    dayNumber: state.dayNumber,
    execution: { ...resolved.execution },
    noExecution: false,
  };
  if (resolved.execution.died) {
    state.executedAndDiedTodayPlayerId = playerId;
  } else {
    delete state.executedAndDiedTodayPlayerId;
  }
  if (resolved.winner && resolved.endReason) {
    state.winner = resolved.winner;
    state.endReason = resolved.endReason;
  }
  return state.dayResolution;
}

export function commitBotcNoExecutionResolution(
  state: BotcDayResolutionRuntimeState,
): BotcDayResolution {
  const resolved = resolveBotcNoExecution(createBotcDayResolutionFacts(state));
  state.dayResolution = {
    dayNumber: state.dayNumber,
    noExecution: true,
  };
  delete state.executedAndDiedTodayPlayerId;
  if (resolved.winner && resolved.endReason) {
    state.winner = resolved.winner;
    state.endReason = resolved.endReason;
  }
  return state.dayResolution;
}

export function shouldVirginExecuteNominator(
  facts: BotcDayResolutionFacts,
  virginPlayerId: string,
  nominatorPlayerId: string,
): boolean {
  const virgin = assignmentFor(facts, virginPlayerId);
  const nominator = assignmentFor(facts, nominatorPlayerId);
  if (
    virgin.actualRoleId !== "virgin" ||
    facts.deadPlayerIds.includes(virginPlayerId) ||
    !isHealthy(facts, virginPlayerId)
  ) {
    return false;
  }
  return troubleBrewingRole(nominator.actualRoleId).category === "townsfolk";
}
