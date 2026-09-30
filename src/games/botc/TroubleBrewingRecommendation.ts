import type { RandomProvider } from "../../core/random/RandomProvider.js";
import type { TroubleBrewingRoleId } from "./TroubleBrewing.js";
import type { TroubleBrewingDemonInfoFacts } from "./TroubleBrewingInformation.js";

export type DemonBluffRecommendationOptionalContext = {
  /**
   * The Townsfolk identity currently shown to an actual Drunk.
   *
   * Rules may still allow this not-in-play character as a Demon bluff. A
   * recommendation policy may use this enrichment to avoid an undesirable
   * claim collision, but it must not rewrite the legal candidate set.
   */
  shownDrunkRoleId?: TroubleBrewingRoleId;
};

export type DemonBluffRecommendationRequest = {
  decisionPoint: "demon_bluffs";
  requiredContext: {
    legalBluffRoleIds: TroubleBrewingRoleId[];
    bluffCount: 3;
  };
  optionalContext?: DemonBluffRecommendationOptionalContext;
};

export type DemonBluffRecommendation = {
  roleIds: TroubleBrewingRoleId[];
};

/**
 * Builds the Recommendation-layer request from already-resolved legal facts.
 * This function does not rank candidates.
 */
export function createDemonBluffRecommendationRequest(
  facts: TroubleBrewingDemonInfoFacts,
  optionalContext?: DemonBluffRecommendationOptionalContext,
): DemonBluffRecommendationRequest {
  return {
    decisionPoint: "demon_bluffs",
    requiredContext: {
      legalBluffRoleIds: [...facts.legalBluffRoleIds],
      bluffCount: 3,
    },
    ...(optionalContext ? { optionalContext: { ...optionalContext } } : {}),
  };
}

/**
 * Guards the boundary between recommendation quality and rules legality.
 *
 * Any future recommendation engine may score/rank candidates however it likes,
 * but the result returned to the Game Engine must remain exactly three unique
 * roles from the Rules/Information legal candidate set.
 */
export function validateDemonBluffRecommendation(
  request: DemonBluffRecommendationRequest,
  recommendation: DemonBluffRecommendation,
): DemonBluffRecommendation {
  if (
    recommendation.roleIds.length !== request.requiredContext.bluffCount ||
    new Set(recommendation.roleIds).size !== request.requiredContext.bluffCount
  ) {
    throw new Error("Demon bluff recommendation must contain three unique roles");
  }

  const legal = new Set(request.requiredContext.legalBluffRoleIds);
  if (recommendation.roleIds.some(roleId => !legal.has(roleId))) {
    throw new Error("Demon bluff recommendation must use only legal bluff candidates");
  }

  return {
    roleIds: [...recommendation.roleIds],
  };
}

/**
 * First concrete automatic Storyteller policy for Demon bluffs.
 *
 * Baseline V1 intentionally keeps quality policy small:
 * - if there are enough alternatives, avoid colliding with the Townsfolk role
 *   currently shown to the Drunk;
 * - otherwise sample three distinct roles from the rules-legal set.
 *
 * More sophisticated narrative/player-history scoring belongs in later
 * Recommendation revisions, not Rules/Information or GameModule.
 */
export function recommendDemonBluffsBaselineV1(
  request: DemonBluffRecommendationRequest,
  random: Pick<RandomProvider, "randomInt">,
): DemonBluffRecommendation {
  const shownDrunkRoleId = request.optionalContext?.shownDrunkRoleId;
  const withoutShownDrunk = shownDrunkRoleId
    ? request.requiredContext.legalBluffRoleIds.filter(
        roleId => roleId !== shownDrunkRoleId,
      )
    : [...request.requiredContext.legalBluffRoleIds];

  const pool =
    withoutShownDrunk.length >= request.requiredContext.bluffCount
      ? [...withoutShownDrunk]
      : [...request.requiredContext.legalBluffRoleIds];

  const roleIds: TroubleBrewingRoleId[] = [];
  while (roleIds.length < request.requiredContext.bluffCount) {
    const index = random.randomInt(pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= pool.length) {
      throw new Error("Demon bluff recommendation random index out of range");
    }
    roleIds.push(pool.splice(index, 1)[0]!);
  }

  return validateDemonBluffRecommendation(request, { roleIds });
}
