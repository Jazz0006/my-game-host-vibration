import type { RandomProvider } from "../../core/random/RandomProvider.js";
import {
  TROUBLE_BREWING_ROLES,
  troubleBrewingBaseCounts,
  type BotcRoleCategory,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import {
  normalizeTroubleBrewingSetup,
  type BotcCanonicalSetupAssignment,
  type BotcSetupAssignment,
} from "./TroubleBrewingSetup.js";

function drawWithoutReplacement<T>(
  values: readonly T[],
  count: number,
  random: RandomProvider,
): T[] {
  if (!Number.isInteger(count) || count < 0 || count > values.length) {
    throw new Error("invalid Trouble Brewing automatic setup draw count");
  }

  const pool = [...values];
  const drawn: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = random.randomInt(pool.length);
    const [selected] = pool.splice(selectedIndex, 1);
    if (selected === undefined) {
      throw new Error("automatic setup draw failed");
    }
    drawn.push(selected);
  }
  return drawn;
}

function shuffle<T>(values: readonly T[], random: RandomProvider): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function rolePool(
  category: BotcRoleCategory,
): TroubleBrewingRoleId[] {
  return TROUBLE_BREWING_ROLES
    .filter(role =>
      role.category === category &&
      // PV-1 baseline deliberately avoids Baron's setup-count mutation.
      role.id !== "baron"
    )
    .map(role => role.id);
}

/**
 * Minimal rules-legal Trouble Brewing setup generator for the playable path.
 *
 * This selector intentionally does not try to optimize game quality. It samples
 * from the base category distribution, excludes Baron for the baseline, and
 * delegates final legality/canonicalization to TroubleBrewingSetup.
 */
export function createTroubleBrewingAutomaticSetup(
  playerIds: readonly string[],
  random: RandomProvider,
): BotcCanonicalSetupAssignment[] {
  const counts = troubleBrewingBaseCounts(playerIds.length);
  const selectedRoles: TroubleBrewingRoleId[] = [];

  for (const category of [
    "townsfolk",
    "outsider",
    "minion",
    "demon",
  ] as const satisfies readonly BotcRoleCategory[]) {
    selectedRoles.push(
      ...drawWithoutReplacement(rolePool(category), counts[category], random),
    );
  }

  const shuffledRoles = shuffle(selectedRoles, random);
  const assignments: BotcSetupAssignment[] = playerIds.map((playerId, index) => ({
    playerId,
    actualRoleId: shuffledRoles[index]!,
  }));

  const actualRoleIds = new Set(assignments.map(item => item.actualRoleId));
  const drunk = assignments.find(item => item.actualRoleId === "drunk");
  if (drunk) {
    const shownCandidates = rolePool("townsfolk").filter(
      roleId => !actualRoleIds.has(roleId),
    );
    if (shownCandidates.length === 0) {
      throw new Error("automatic Drunk setup has no legal shown Townsfolk");
    }
    drunk.shownRoleId =
      shownCandidates[random.randomInt(shownCandidates.length)]!;
  }

  return normalizeTroubleBrewingSetup(playerIds, assignments);
}
