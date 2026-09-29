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
      actorSource: "actual" | "shown_drunk";
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

export function troubleBrewingNightRoleOrder(
  nightKind: BotcNightKind,
): readonly TroubleBrewingRoleId[] {
  return nightKind === "first"
    ? TROUBLE_BREWING_FIRST_NIGHT_ROLE_ORDER
    : TROUBLE_BREWING_OTHER_NIGHT_ROLE_ORDER;
}
