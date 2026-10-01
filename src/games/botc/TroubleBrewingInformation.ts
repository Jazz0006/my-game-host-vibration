import {
  TROUBLE_BREWING_ROLES,
  troubleBrewingRole,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";
import type { TroubleBrewingFortuneTellerInformationResolution } from "./TroubleBrewingFortuneTeller.js";
import {
  troubleBrewingAlignmentRegistrations,
  troubleBrewingCharacterRegistrations,
  type TroubleBrewingAlignmentRegistration,
  type TroubleBrewingCharacterRegistrationSource,
} from "./TroubleBrewingRegistration.js";

export type TroubleBrewingDemonInfoFacts = {
  demonPlayerId: string;
  minionPlayerIds: string[];
  legalBluffRoleIds: TroubleBrewingRoleId[];
};

/**
 * Resolves the authoritative standard Demon Info facts for Trouble Brewing.
 *
 * This owner decides only what is rules-legal:
 * - who the Demon is;
 * - which players are Minions;
 * - which good characters are actually not in play and may therefore be used
 *   as Demon bluffs.
 *
 * It deliberately does not choose which three bluffs are best.
 */
export function createTroubleBrewingDemonInfoFacts(
  assignments: readonly BotcCanonicalSetupAssignment[],
): TroubleBrewingDemonInfoFacts {
  if (assignments.length < 7) {
    throw new Error("Trouble Brewing standard Demon Info requires at least 7 players");
  }

  const demonAssignments = assignments.filter(
    assignment => troubleBrewingRole(assignment.actualRoleId).category === "demon",
  );
  if (demonAssignments.length !== 1) {
    throw new Error("Trouble Brewing Demon Info requires exactly one actual Demon");
  }

  const inPlayActualRoleIds = new Set(
    assignments.map(assignment => assignment.actualRoleId),
  );

  const legalBluffRoleIds = TROUBLE_BREWING_ROLES
    .filter(role => role.category === "townsfolk" || role.category === "outsider")
    .map(role => role.id)
    .filter(roleId => !inPlayActualRoleIds.has(roleId));

  if (legalBluffRoleIds.length < 3) {
    throw new Error("Trouble Brewing Demon Info requires at least three legal good bluffs");
  }

  return {
    demonPlayerId: demonAssignments[0]!.playerId,
    minionPlayerIds: assignments
      .filter(
        assignment =>
          troubleBrewingRole(assignment.actualRoleId).category === "minion",
      )
      .map(assignment => assignment.playerId),
    legalBluffRoleIds: [...legalBluffRoleIds],
  };
}

export type TroubleBrewingPairInformationAbilityRoleId =
  | "washerwoman"
  | "librarian"
  | "investigator";

export type TroubleBrewingPairInformationResolution = {
  matchingPlayerId: string;
  matchSource: TroubleBrewingCharacterRegistrationSource;
};

export type TroubleBrewingNoCharactersInformationResolution = {
  noCharacterCategory: "outsider";
  truthSource: "actual_state";
};

export type TroubleBrewingWasherwomanInformationResolution =
  TroubleBrewingPairInformationResolution;

export type TroubleBrewingInformationReliability =
  | "reliable"
  | "drunk"
  | "poisoned";

export type TroubleBrewingSemanticTruth =
  | "true"
  | "false"
  | "partially_true"
  | "not_applicable";

export type TroubleBrewingPairInformationCandidate = {
  candidateId: string;
  learnedRoleId: TroubleBrewingRoleId;
  shownPlayerIds: [string, string];
  legalResolutions: TroubleBrewingPairInformationResolution[];
};

export type TroubleBrewingNoCharactersInformationCandidate = {
  candidateId: string;
  noCharacterCategory: "outsider";
  legalResolutions: TroubleBrewingNoCharactersInformationResolution[];
};

export type TroubleBrewingInformationCandidate =
  | TroubleBrewingPairInformationCandidate
  | TroubleBrewingNoCharactersInformationCandidate;

export type TroubleBrewingWasherwomanInformationCandidate =
  TroubleBrewingPairInformationCandidate;

export type TroubleBrewingPairInformationResult =
  | {
      kind: "pair";
      abilityRoleId: TroubleBrewingPairInformationAbilityRoleId;
      recipientPlayerId: string;
      learnedRoleId: TroubleBrewingRoleId;
      shownPlayerIds: [string, string];
      reliability: TroubleBrewingInformationReliability;
      semanticTruth: TroubleBrewingSemanticTruth;
      selectedCandidateId: string;
      selectedResolution: TroubleBrewingPairInformationResolution;
    }
  | {
      kind: "no_characters";
      abilityRoleId: "librarian";
      recipientPlayerId: string;
      noCharacterCategory: "outsider";
      reliability: TroubleBrewingInformationReliability;
      semanticTruth: TroubleBrewingSemanticTruth;
      selectedCandidateId: string;
      selectedResolution: TroubleBrewingNoCharactersInformationResolution;
    };

export type TroubleBrewingWasherwomanInformationResult = Extract<
  TroubleBrewingPairInformationResult,
  { kind: "pair" }
> & {
  abilityRoleId: "washerwoman";
};

export type TroubleBrewingNumericInformationAbilityRoleId = "chef" | "empath";

export type TroubleBrewingChefPairResolution = {
  playerIds: [string, string];
  leftRegistration: TroubleBrewingAlignmentRegistration;
  rightRegistration: TroubleBrewingAlignmentRegistration;
  countsAsEvilPair: boolean;
};

export type TroubleBrewingChefInformationResolution = {
  kind: "chef_pairs";
  pairs: TroubleBrewingChefPairResolution[];
};

export type TroubleBrewingEmpathInformationResolution = {
  kind: "empath_neighbors";
  clockwiseNeighborPlayerId: string;
  counterclockwiseNeighborPlayerId: string;
  clockwiseRegistration: TroubleBrewingAlignmentRegistration;
  counterclockwiseRegistration: TroubleBrewingAlignmentRegistration;
};

export type TroubleBrewingNumericInformationResolution =
  | TroubleBrewingChefInformationResolution
  | TroubleBrewingEmpathInformationResolution;

export type TroubleBrewingNumericInformationCandidate = {
  candidateId: string;
  value: number;
  legalResolutions: TroubleBrewingNumericInformationResolution[];
};

export type TroubleBrewingNumericInformationResult = {
  kind: "number";
  abilityRoleId: TroubleBrewingNumericInformationAbilityRoleId;
  recipientPlayerId: string;
  value: number;
  reliability: TroubleBrewingInformationReliability;
  semanticTruth: TroubleBrewingSemanticTruth;
  selectedCandidateId: string;
  selectedResolution: TroubleBrewingNumericInformationResolution;
};

export type TroubleBrewingBooleanInformationResult = {
  kind: "boolean";
  abilityRoleId: "fortune_teller";
  recipientPlayerId: string;
  value: boolean;
  reliability: TroubleBrewingInformationReliability;
  semanticTruth: TroubleBrewingSemanticTruth;
  selectedCandidateId: string;
  selectedResolution: TroubleBrewingFortuneTellerInformationResolution;
};

export type TroubleBrewingNightInformationResult =
  | TroubleBrewingPairInformationResult
  | TroubleBrewingNumericInformationResult
  | TroubleBrewingBooleanInformationResult;

export function isTroubleBrewingPairCandidate(
  candidate: TroubleBrewingInformationCandidate,
): candidate is TroubleBrewingPairInformationCandidate {
  return "learnedRoleId" in candidate;
}

function pairInformationTargetCategory(
  abilityRoleId: TroubleBrewingPairInformationAbilityRoleId,
): "townsfolk" | "outsider" | "minion" {
  switch (abilityRoleId) {
    case "washerwoman":
      return "townsfolk";
    case "librarian":
      return "outsider";
    case "investigator":
      return "minion";
  }
}

/**
 * Generates the natural truthful information domain shared by Washerwoman,
 * Librarian and Investigator.
 *
 * Pair-visible statements are unique by learned character + shown player pair.
 * Multiple registration witnesses for the same visible statement are grouped
 * as legal resolutions so registration multiplicity never becomes accidental
 * recommendation weight.
 *
 * The information recipient remains a legal member of the shown pair. This is
 * required for valid Baron setups where the Washerwoman can be the only
 * Townsfolk in play and therefore must be able to learn themself plus one
 * other player. The optional recipient argument is retained at this boundary
 * to make that rule choice explicit for runtime callers.
 *
 * Librarian additionally has one typed "no Outsiders" candidate only when
 * there are no actual Outsiders in play. A Spy may still create registered-
 * Outsider pair candidates in that setup; registration does not invalidate
 * the natural zero-Outsider statement.
 */
export function createTroubleBrewingPairInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  abilityRoleId: TroubleBrewingPairInformationAbilityRoleId,
  _recipientPlayerId?: string,
): TroubleBrewingInformationCandidate[] {
  const targetCategory = pairInformationTargetCategory(abilityRoleId);
  const candidates = new Map<string, TroubleBrewingPairInformationCandidate>();

  assignments.forEach((matchingAssignment, matchingIndex) => {
    for (const registration of troubleBrewingCharacterRegistrations(
      matchingAssignment,
    )) {
      if (troubleBrewingRole(registration.roleId).category !== targetCategory) {
        continue;
      }

      assignments.forEach((otherAssignment, otherIndex) => {
        if (otherIndex === matchingIndex) {
          return;
        }

        const shownPlayerIds: [string, string] =
          matchingIndex < otherIndex
            ? [matchingAssignment.playerId, otherAssignment.playerId]
            : [otherAssignment.playerId, matchingAssignment.playerId];
        const key = JSON.stringify([
          registration.roleId,
          shownPlayerIds[0],
          shownPlayerIds[1],
        ]);

        const resolution: TroubleBrewingPairInformationResolution = {
          matchingPlayerId: matchingAssignment.playerId,
          matchSource: registration.source,
        };
        const existing = candidates.get(key);
        if (existing) {
          if (
            !existing.legalResolutions.some(
              item =>
                item.matchingPlayerId === resolution.matchingPlayerId &&
                item.matchSource === resolution.matchSource,
            )
          ) {
            existing.legalResolutions.push(resolution);
          }
          return;
        }

        candidates.set(key, {
          candidateId: `${abilityRoleId}:${registration.roleId}:${shownPlayerIds[0]}:${shownPlayerIds[1]}`,
          learnedRoleId: registration.roleId,
          shownPlayerIds,
          legalResolutions: [resolution],
        });
      });
    }
  });

  const pairCandidates = [...candidates.values()];
  if (
    abilityRoleId === "librarian" &&
    !assignments.some(
      assignment => troubleBrewingRole(assignment.actualRoleId).category === "outsider",
    )
  ) {
    const zeroCandidate: TroubleBrewingNoCharactersInformationCandidate = {
      candidateId: "librarian:no-outsiders",
      noCharacterCategory: "outsider",
      legalResolutions: [
        {
          noCharacterCategory: "outsider",
          truthSource: "actual_state",
        },
      ],
    };
    return [zeroCandidate, ...pairCandidates];
  }

  return pairCandidates;
}

export function createTroubleBrewingWasherwomanInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  recipientPlayerId?: string,
): TroubleBrewingWasherwomanInformationCandidate[] {
  return createTroubleBrewingPairInformationCandidates(
    assignments,
    "washerwoman",
    recipientPlayerId,
  ).filter(isTroubleBrewingPairCandidate);
}

export function createTroubleBrewingLibrarianInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  recipientPlayerId?: string,
): TroubleBrewingInformationCandidate[] {
  return createTroubleBrewingPairInformationCandidates(
    assignments,
    "librarian",
    recipientPlayerId,
  );
}

export function createTroubleBrewingInvestigatorInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  recipientPlayerId?: string,
): TroubleBrewingPairInformationCandidate[] {
  return createTroubleBrewingPairInformationCandidates(
    assignments,
    "investigator",
    recipientPlayerId,
  ).filter(isTroubleBrewingPairCandidate);
}

function seatingAssignments(
  assignments: readonly BotcCanonicalSetupAssignment[],
  seatingPlayerIds: readonly string[],
): BotcCanonicalSetupAssignment[] {
  if (seatingPlayerIds.length !== assignments.length || seatingPlayerIds.length < 3) {
    throw new Error("Trouble Brewing numeric information requires the full seating order");
  }
  if (new Set(seatingPlayerIds).size !== seatingPlayerIds.length) {
    throw new Error("Trouble Brewing seating order contains duplicate players");
  }

  const byPlayerId = new Map(assignments.map(assignment => [assignment.playerId, assignment]));
  if (byPlayerId.size !== assignments.length) {
    throw new Error("Trouble Brewing assignments contain duplicate players");
  }

  const ordered = seatingPlayerIds.map(playerId => {
    const assignment = byPlayerId.get(playerId);
    if (!assignment) {
      throw new Error("Trouble Brewing seating order references a non-player");
    }
    return assignment;
  });
  if (ordered.length !== byPlayerId.size) {
    throw new Error("Trouble Brewing seating order does not cover every player");
  }
  return ordered;
}

function cloneAlignmentRegistration(
  registration: TroubleBrewingAlignmentRegistration,
): TroubleBrewingAlignmentRegistration {
  return { ...registration };
}

function chefPairOptions(
  left: BotcCanonicalSetupAssignment,
  right: BotcCanonicalSetupAssignment,
): TroubleBrewingChefPairResolution[] {
  const options: TroubleBrewingChefPairResolution[] = [];
  for (const leftRegistration of troubleBrewingAlignmentRegistrations(left)) {
    for (const rightRegistration of troubleBrewingAlignmentRegistrations(right)) {
      options.push({
        playerIds: [left.playerId, right.playerId],
        leftRegistration: cloneAlignmentRegistration(leftRegistration),
        rightRegistration: cloneAlignmentRegistration(rightRegistration),
        countsAsEvilPair:
          leftRegistration.alignment === "evil" &&
          rightRegistration.alignment === "evil",
      });
    }
  }
  return options;
}

function collectChefResolutions(
  optionGroups: readonly TroubleBrewingChefPairResolution[][],
  index: number,
  current: TroubleBrewingChefPairResolution[],
  output: TroubleBrewingChefInformationResolution[],
): void {
  if (index >= optionGroups.length) {
    output.push({
      kind: "chef_pairs",
      pairs: current.map(pair => ({
        ...pair,
        playerIds: [...pair.playerIds] as [string, string],
        leftRegistration: cloneAlignmentRegistration(pair.leftRegistration),
        rightRegistration: cloneAlignmentRegistration(pair.rightRegistration),
      })),
    });
    return;
  }

  for (const option of optionGroups[index] ?? []) {
    current.push(option);
    collectChefResolutions(optionGroups, index + 1, current, output);
    current.pop();
  }
}

function numericCandidates(
  abilityRoleId: TroubleBrewingNumericInformationAbilityRoleId,
  resolutions: readonly TroubleBrewingNumericInformationResolution[],
  valueFor: (resolution: TroubleBrewingNumericInformationResolution) => number,
): TroubleBrewingNumericInformationCandidate[] {
  const candidates = new Map<number, TroubleBrewingNumericInformationCandidate>();
  for (const resolution of resolutions) {
    const value = valueFor(resolution);
    const existing = candidates.get(value);
    if (existing) {
      existing.legalResolutions.push(resolution);
      continue;
    }
    candidates.set(value, {
      candidateId: `${abilityRoleId}:number:${value}`,
      value,
      legalResolutions: [resolution],
    });
  }
  return [...candidates.values()].sort((left, right) => left.value - right.value);
}

/**
 * Generates every rules-legal Chef number for the current circular seating.
 * Spy/Recluse registration is evaluated independently for each adjacent pair,
 * matching the Trouble Brewing rule that one player may register differently
 * for separate pair checks within the same Chef information event.
 */
export function createTroubleBrewingChefInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  seatingPlayerIds: readonly string[],
): TroubleBrewingNumericInformationCandidate[] {
  const ordered = seatingAssignments(assignments, seatingPlayerIds);
  const optionGroups = ordered.map((left, index) =>
    chefPairOptions(left, ordered[(index + 1) % ordered.length]!),
  );
  const resolutions: TroubleBrewingChefInformationResolution[] = [];
  collectChefResolutions(optionGroups, 0, [], resolutions);
  return numericCandidates(
    "chef",
    resolutions,
    resolution =>
      resolution.kind === "chef_pairs"
        ? resolution.pairs.filter(pair => pair.countsAsEvilPair).length
        : 0,
  );
}

function closestAliveNeighbor(
  seatingPlayerIds: readonly string[],
  deadPlayerIds: ReadonlySet<string>,
  recipientIndex: number,
  direction: -1 | 1,
): string | undefined {
  for (let offset = 1; offset < seatingPlayerIds.length; offset += 1) {
    const index =
      (recipientIndex + direction * offset + seatingPlayerIds.length) %
      seatingPlayerIds.length;
    const playerId = seatingPlayerIds[index]!;
    if (!deadPlayerIds.has(playerId)) return playerId;
  }
  return undefined;
}

/**
 * Generates every rules-legal Empath number from the two closest distinct alive
 * neighbours. Dead seated players are skipped independently clockwise and
 * counterclockwise. Registration ambiguity remains explicit provenance.
 */
export function createTroubleBrewingEmpathInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  seatingPlayerIds: readonly string[],
  deadPlayerIds: readonly string[],
  recipientPlayerId: string,
): TroubleBrewingNumericInformationCandidate[] {
  const ordered = seatingAssignments(assignments, seatingPlayerIds);
  const recipientIndex = seatingPlayerIds.indexOf(recipientPlayerId);
  if (recipientIndex < 0) {
    throw new Error("Empath recipient is not in the seating order");
  }

  const dead = new Set(deadPlayerIds);
  if (dead.has(recipientPlayerId)) {
    throw new Error("Dead Empath cannot receive living-neighbour information");
  }
  for (const playerId of dead) {
    if (!seatingPlayerIds.includes(playerId)) {
      throw new Error("Empath dead-player state references a non-player");
    }
  }

  const clockwiseNeighborPlayerId = closestAliveNeighbor(
    seatingPlayerIds,
    dead,
    recipientIndex,
    1,
  );
  const counterclockwiseNeighborPlayerId = closestAliveNeighbor(
    seatingPlayerIds,
    dead,
    recipientIndex,
    -1,
  );
  if (
    !clockwiseNeighborPlayerId ||
    !counterclockwiseNeighborPlayerId ||
    clockwiseNeighborPlayerId === counterclockwiseNeighborPlayerId
  ) {
    throw new Error("Empath requires two distinct alive neighbours");
  }

  const byPlayerId = new Map(ordered.map(assignment => [assignment.playerId, assignment]));
  const clockwise = byPlayerId.get(clockwiseNeighborPlayerId)!;
  const counterclockwise = byPlayerId.get(counterclockwiseNeighborPlayerId)!;
  const resolutions: TroubleBrewingEmpathInformationResolution[] = [];
  for (const clockwiseRegistration of troubleBrewingAlignmentRegistrations(clockwise)) {
    for (const counterclockwiseRegistration of troubleBrewingAlignmentRegistrations(counterclockwise)) {
      resolutions.push({
        kind: "empath_neighbors",
        clockwiseNeighborPlayerId,
        counterclockwiseNeighborPlayerId,
        clockwiseRegistration: cloneAlignmentRegistration(clockwiseRegistration),
        counterclockwiseRegistration: cloneAlignmentRegistration(counterclockwiseRegistration),
      });
    }
  }

  return numericCandidates(
    "empath",
    resolutions,
    resolution => {
      if (resolution.kind !== "empath_neighbors") return 0;
      return Number(resolution.clockwiseRegistration.alignment === "evil") +
        Number(resolution.counterclockwiseRegistration.alignment === "evil");
    },
  );
}
