import { troubleBrewingRole } from "./TroubleBrewing.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";
import type { TroubleBrewingOtherNightRoleTransition } from "./TroubleBrewingNightSequence.js";
import type { BotcGameEndReason, BotcWinner } from "./BotcDayResolution.js";

export type BotcImpAttackFacts = {
  seatingPlayerIds: readonly string[];
  assignments: readonly BotcCanonicalSetupAssignment[];
  deadPlayerIds: readonly string[];
  poisonedPlayerId?: string;
  monkProtectedPlayerId?: string;
};

export type BotcImpAttackResolution = {
  targetPlayerId: string;
  targetDied: boolean;
  deadPlayerIds: string[];
  diedTonightPlayerIds: string[];
  roleTransitions: TroubleBrewingOtherNightRoleTransition[];
  winner?: BotcWinner;
  endReason?: BotcGameEndReason;
};

export type BotcNightAttackRuntimeState = BotcImpAttackFacts & {
  diedTonightPlayerIds: string[];
  roleTransitions: TroubleBrewingOtherNightRoleTransition[];
  winner?: BotcWinner;
  endReason?: BotcGameEndReason;
};

function aliveCount(
  facts: BotcImpAttackFacts,
  deadPlayerIds: readonly string[],
): number {
  const dead = new Set(deadPlayerIds);
  return facts.seatingPlayerIds.filter(playerId => !dead.has(playerId)).length;
}

function assignmentFor(
  facts: BotcImpAttackFacts,
  playerId: string,
): BotcCanonicalSetupAssignment {
  const assignment = facts.assignments.find(item => item.playerId === playerId);
  if (!assignment) throw new Error("BotC Imp attack references a non-player");
  return assignment;
}

function aliveMinionSuccessor(
  facts: BotcImpAttackFacts,
  previousImpPlayerId: string,
): string | undefined {
  return facts.assignments.find(assignment =>
    assignment.playerId !== previousImpPlayerId &&
    troubleBrewingRole(assignment.actualRoleId).category === "minion" &&
    !facts.deadPlayerIds.includes(assignment.playerId)
  )?.playerId;
}

function targetIsSafeFromDemon(
  facts: BotcImpAttackFacts,
  targetPlayerId: string,
): boolean {
  if (facts.monkProtectedPlayerId === targetPlayerId) return true;

  const target = assignmentFor(facts, targetPlayerId);
  return (
    target.actualRoleId === "soldier" &&
    facts.poisonedPlayerId !== targetPlayerId
  );
}

export function resolveBotcImpAttack(
  facts: BotcImpAttackFacts,
  impPlayerId: string,
  targetPlayerId: string,
  abilityApplies: boolean,
): BotcImpAttackResolution {
  assignmentFor(facts, impPlayerId);
  assignmentFor(facts, targetPlayerId);

  const deadPlayerIds = [...facts.deadPlayerIds];
  const diedTonightPlayerIds: string[] = [];
  const roleTransitions: TroubleBrewingOtherNightRoleTransition[] = [];

  const effective =
    abilityApplies &&
    facts.poisonedPlayerId !== impPlayerId &&
    !facts.deadPlayerIds.includes(targetPlayerId) &&
    !targetIsSafeFromDemon(facts, targetPlayerId);

  if (!effective) {
    return {
      targetPlayerId,
      targetDied: false,
      deadPlayerIds,
      diedTonightPlayerIds,
      roleTransitions,
    };
  }

  deadPlayerIds.push(targetPlayerId);
  diedTonightPlayerIds.push(targetPlayerId);

  if (targetPlayerId === impPlayerId) {
    const successor = aliveMinionSuccessor(facts, impPlayerId);
    if (successor) {
      roleTransitions.push({
        kind: "imp_self_kill_to_imp",
        previousImpPlayerId: impPlayerId,
        newImpPlayerId: successor,
      });
    } else {
      return {
        targetPlayerId,
        targetDied: true,
        deadPlayerIds,
        diedTonightPlayerIds,
        roleTransitions,
        winner: "good",
        endReason: "demon_died",
      };
    }
  }

  if (aliveCount(facts, deadPlayerIds) <= 2) {
    return {
      targetPlayerId,
      targetDied: true,
      deadPlayerIds,
      diedTonightPlayerIds,
      roleTransitions,
      winner: "evil",
      endReason: "two_alive",
    };
  }

  return {
    targetPlayerId,
    targetDied: true,
    deadPlayerIds,
    diedTonightPlayerIds,
    roleTransitions,
  };
}

export function commitBotcImpAttack(
  state: BotcNightAttackRuntimeState,
  impPlayerId: string,
  targetPlayerId: string,
  abilityApplies: boolean,
): BotcImpAttackResolution {
  const resolved = resolveBotcImpAttack(
    state,
    impPlayerId,
    targetPlayerId,
    abilityApplies,
  );
  state.deadPlayerIds = [...resolved.deadPlayerIds];
  state.diedTonightPlayerIds = [...resolved.diedTonightPlayerIds];
  state.roleTransitions.push(...resolved.roleTransitions);
  if (resolved.winner && resolved.endReason) {
    state.winner = resolved.winner;
    state.endReason = resolved.endReason;
  }
  return resolved;
}
