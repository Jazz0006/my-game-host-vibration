import {
  troubleBrewingRole,
  type BotcRoleCategory,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";

export type BotcNightKind = "first" | "other";

export type BotcNightSystemStepId = "minion_info" | "demon_info";

export type BotcNightAssignment = {
  playerId: string;
  actualRoleId: TroubleBrewingRoleId;
  shownRoleId: TroubleBrewingRoleId;
};

export type BotcNightRoleTransitionKind =
  | "scarlet_woman_to_imp"
  | "imp_self_kill_to_imp";

export type BotcNightStep =
  | {
      id: BotcNightSystemStepId;
      kind: "system_info";
      actorPlayerIds: string[];
    }
  | {
      id: `role:${TroubleBrewingRoleId}`;
      kind: "role";
      roleId: TroubleBrewingRoleId;
      actorPlayerIds: string[];
      actorSource: "actual" | "shown_drunk" | "role_transition";
    }
  | {
      id: `role_change:${BotcNightRoleTransitionKind}`;
      kind: "role_change_info";
      roleId: "imp";
      actorPlayerIds: string[];
      transitionKind: BotcNightRoleTransitionKind;
    };

export const TROUBLE_BREWING_FIRST_NIGHT_ROLE_ORDER = [
  "poisoner",
  "spy",
  "washerwoman",
  "librarian",
  "investigator",
  "chef",
  "empath",
  "fortune_teller",
  "butler",
] as const satisfies readonly TroubleBrewingRoleId[];

export const TROUBLE_BREWING_OTHER_NIGHT_ROLE_ORDER = [
  "poisoner",
  "monk",
  "spy",
  "scarlet_woman",
  "imp",
  "ravenkeeper",
  "undertaker",
  "empath",
  "fortune_teller",
  "butler",
] as const satisfies readonly TroubleBrewingRoleId[];

function evilActors(
  assignments: readonly BotcNightAssignment[],
  category: Extract<BotcRoleCategory, "minion" | "demon">,
): string[] {
  return assignments
    .filter(assignment => troubleBrewingRole(assignment.actualRoleId).category === category)
    .map(assignment => assignment.playerId);
}

function actorForRole(
  assignments: readonly BotcNightAssignment[],
  roleId: TroubleBrewingRoleId,
): BotcNightStep | undefined {
  const actual = assignments.find(assignment => assignment.actualRoleId === roleId);
  if (actual) {
    return {
      id: `role:${roleId}`,
      kind: "role",
      roleId,
      actorPlayerIds: [actual.playerId],
      actorSource: "actual",
    };
  }

  const shownDrunk = assignments.find(
    assignment =>
      assignment.actualRoleId === "drunk" &&
      assignment.shownRoleId === roleId,
  );
  if (!shownDrunk) return undefined;

  return {
    id: `role:${roleId}`,
    kind: "role",
    roleId,
    actorPlayerIds: [shownDrunk.playerId],
    actorSource: "shown_drunk",
  };
}

/**
 * Creates the deterministic first-night wake/information sequence for the
 * canonical Trouble Brewing setup.
 *
 * The sequence owns only ordering and actors. Role choices, information
 * payloads, poisoning effects, registration decisions, and storyteller
 * recommendations belong to later BotC rules/information slices.
 */
export function createTroubleBrewingFirstNightSequence(
  assignments: readonly BotcNightAssignment[],
): BotcNightStep[] {
  const steps: BotcNightStep[] = [];

  // Standard BotC Minion/Demon info is skipped in ordinary 5–6 player games.
  if (assignments.length >= 7) {
    steps.push({
      id: "minion_info",
      kind: "system_info",
      actorPlayerIds: evilActors(assignments, "minion"),
    });
    steps.push({
      id: "demon_info",
      kind: "system_info",
      actorPlayerIds: evilActors(assignments, "demon"),
    });
  }

  for (const roleId of TROUBLE_BREWING_FIRST_NIGHT_ROLE_ORDER) {
    const step = actorForRole(assignments, roleId);
    if (step) steps.push(step);
  }

  return steps;
}

export type TroubleBrewingOtherNightRoleTransition =
  | {
      kind: "scarlet_woman_to_imp";
      playerId: string;
    }
  | {
      kind: "imp_self_kill_to_imp";
      previousImpPlayerId: string;
      newImpPlayerId: string;
    };

export type TroubleBrewingOtherNightFacts = {
  assignments: readonly BotcNightAssignment[];
  deadPlayerIds: readonly string[];
  diedTonightPlayerIds: readonly string[];
  executedAndDiedTodayPlayerId?: string;
  roleTransitions?: readonly TroubleBrewingOtherNightRoleTransition[];
};

function otherNightActor(
  facts: TroubleBrewingOtherNightFacts,
  roleId: TroubleBrewingRoleId,
): BotcNightStep | undefined {
  if (roleId === "scarlet_woman") {
    // Scarlet Woman is not a recurring night action. Her ability changes
    // character immediately when a qualifying Demon death occurs; the
    // resulting character-change notification belongs to B0B2B trigger /
    // role-transition sequencing rather than ordinary eligibility.
    return undefined;
  }

  const candidates: Array<{
    playerId: string;
    source: "actual" | "shown_drunk";
  }> = [
    ...facts.assignments
      .filter(assignment => assignment.actualRoleId === roleId)
      .map(assignment => ({
        playerId: assignment.playerId,
        source: "actual" as const,
      })),
    ...facts.assignments
      .filter(
        assignment =>
          assignment.actualRoleId === "drunk" &&
          assignment.shownRoleId === roleId,
      )
      .map(assignment => ({
        playerId: assignment.playerId,
        source: "shown_drunk" as const,
      })),
  ];

  const actor = candidates.find(candidate => {
    switch (roleId) {
      case "ravenkeeper":
        // The Ravenkeeper is the explicit Trouble Brewing exception to the
        // normal dead-players-have-no-ability rule: dying at night triggers it.
        return facts.diedTonightPlayerIds.includes(candidate.playerId);

      case "undertaker":
        return (
          !facts.deadPlayerIds.includes(candidate.playerId) &&
          facts.executedAndDiedTodayPlayerId !== undefined
        );

      default:
        // Runtime role changes may leave a dead former character and an alive
        // successor sharing the same current character ID. Eligibility must
        // therefore choose an alive actor rather than the first setup match.
        return !facts.deadPlayerIds.includes(candidate.playerId);
    }
  });

  if (!actor) return undefined;
  return {
    id: `role:${roleId}`,
    kind: "role",
    roleId,
    actorPlayerIds: [actor.playerId],
    actorSource: actor.source,
  };
}

function assignmentForPlayer(
  facts: TroubleBrewingOtherNightFacts,
  playerId: string,
): BotcNightAssignment {
  const assignment = facts.assignments.find(item => item.playerId === playerId);
  if (!assignment) {
    throw new Error("BotC night transition references a non-player");
  }
  return assignment;
}

function roleTransitionFacts(
  facts: TroubleBrewingOtherNightFacts,
): {
  scarletWoman?: Extract<
    TroubleBrewingOtherNightRoleTransition,
    { kind: "scarlet_woman_to_imp" }
  >;
  impSelfKill?: Extract<
    TroubleBrewingOtherNightRoleTransition,
    { kind: "imp_self_kill_to_imp" }
  >;
} {
  const transitions = facts.roleTransitions ?? [];
  const scarletWomen = transitions.filter(
    transition => transition.kind === "scarlet_woman_to_imp",
  );
  const impSelfKills = transitions.filter(
    transition => transition.kind === "imp_self_kill_to_imp",
  );

  if (scarletWomen.length > 1 || impSelfKills.length > 1) {
    throw new Error("Trouble Brewing night contains duplicate role transitions");
  }

  const scarletWoman = scarletWomen[0];
  if (scarletWoman) {
    const assignment = assignmentForPlayer(facts, scarletWoman.playerId);
    if (assignment.actualRoleId !== "scarlet_woman") {
      throw new Error("Scarlet Woman transition must reference the Scarlet Woman");
    }
  }

  const impSelfKill = impSelfKills[0];
  if (impSelfKill) {
    const previousImp = assignmentForPlayer(
      facts,
      impSelfKill.previousImpPlayerId,
    );
    const newImp = assignmentForPlayer(facts, impSelfKill.newImpPlayerId);
    if (impSelfKill.previousImpPlayerId === impSelfKill.newImpPlayerId) {
      throw new Error("Imp self-kill successor must be a different player");
    }
    if (
      !scarletWoman &&
      previousImp.actualRoleId !== "imp"
    ) {
      throw new Error("Imp self-kill transition must reference the acting Imp");
    }
    if (
      troubleBrewingRole(newImp.actualRoleId).category !== "minion" ||
      facts.deadPlayerIds.includes(impSelfKill.newImpPlayerId)
    ) {
      throw new Error("Imp self-kill transition requires an alive Minion successor");
    }
    if (
      scarletWoman &&
      impSelfKill.previousImpPlayerId !== scarletWoman.playerId
    ) {
      throw new Error(
        "Imp self-kill transition must follow the Scarlet Woman successor when both transitions occur",
      );
    }
  }

  return {
    ...(scarletWoman ? { scarletWoman } : {}),
    ...(impSelfKill ? { impSelfKill } : {}),
  };
}

function roleChangeInfoStep(
  transitionKind: BotcNightRoleTransitionKind,
  playerId: string,
): BotcNightStep {
  return {
    id: `role_change:${transitionKind}`,
    kind: "role_change_info",
    roleId: "imp",
    actorPlayerIds: [playerId],
    transitionKind,
  };
}

function impActionStep(
  facts: TroubleBrewingOtherNightFacts,
  scarletWoman: Extract<
    TroubleBrewingOtherNightRoleTransition,
    { kind: "scarlet_woman_to_imp" }
  > | undefined,
  impSelfKill: Extract<
    TroubleBrewingOtherNightRoleTransition,
    { kind: "imp_self_kill_to_imp" }
  > | undefined,
): BotcNightStep | undefined {
  if (impSelfKill) {
    return {
      id: "role:imp",
      kind: "role",
      roleId: "imp",
      actorPlayerIds: [impSelfKill.previousImpPlayerId],
      actorSource: "role_transition",
    };
  }

  if (scarletWoman) {
    return facts.deadPlayerIds.includes(scarletWoman.playerId)
      ? undefined
      : {
          id: "role:imp",
          kind: "role",
          roleId: "imp",
          actorPlayerIds: [scarletWoman.playerId],
          actorSource: "role_transition",
        };
  }

  return otherNightActor(facts, "imp");
}

/**
 * Projects the currently known Trouble Brewing other-night timeline.
 *
 * Ordinary wake eligibility is re-evaluatable from live authoritative facts.
 * The only role changes represented here are concrete Trouble Brewing
 * transitions that have already been resolved by game rules. This keeps
 * sequencing responsible for order without making the night sheet decide why
 * a character change occurred.
 */
export function createTroubleBrewingOtherNightSequence(
  facts: TroubleBrewingOtherNightFacts,
): BotcNightStep[] {
  const steps: BotcNightStep[] = [];
  const { scarletWoman, impSelfKill } = roleTransitionFacts(facts);

  for (const roleId of TROUBLE_BREWING_OTHER_NIGHT_ROLE_ORDER) {
    if (roleId === "scarlet_woman") {
      if (scarletWoman) {
        steps.push(
          roleChangeInfoStep("scarlet_woman_to_imp", scarletWoman.playerId),
        );
      }
      continue;
    }

    if (roleId === "imp") {
      const impStep = impActionStep(facts, scarletWoman, impSelfKill);
      if (impStep) steps.push(impStep);
      if (impSelfKill) {
        steps.push(
          roleChangeInfoStep(
            "imp_self_kill_to_imp",
            impSelfKill.newImpPlayerId,
          ),
        );
      }
      continue;
    }

    const step = otherNightActor(facts, roleId);
    if (step) steps.push(step);
  }

  return steps;
}

export function troubleBrewingNightRoleOrder(
  nightKind: BotcNightKind,
): readonly TroubleBrewingRoleId[] {
  return nightKind === "first"
    ? TROUBLE_BREWING_FIRST_NIGHT_ROLE_ORDER
    : TROUBLE_BREWING_OTHER_NIGHT_ROLE_ORDER;
}
