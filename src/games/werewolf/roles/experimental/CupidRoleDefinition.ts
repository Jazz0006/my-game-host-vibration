import type { Role } from "../../../../domain/game.js";
import type { WerewolfRoleDefinition } from "../RoleDefinition.js";
import {
  addLoversRelationship,
  loverOf,
  type WerewolfRuleState,
} from "../WerewolfRuleState.js";

export type CupidSpikeRoleId = Role | "cupid";
export type CupidSpikeInteractionKind = "cupid_link_lovers";

export function applyCupidFirstNightSelection(
  ruleState: WerewolfRuleState,
  cupidPlayerId: string,
  targetPlayerIds: readonly [string, string],
  relationshipId: string,
): void {
  addLoversRelationship(ruleState, {
    id: relationshipId,
    kind: "lovers",
    sourceRolePlayerId: cupidPlayerId,
    playerIds: targetPlayerIds,
  });
}

/**
 * Architecture-spike definition only. This is intentionally not registered in
 * the production role catalog or script deck yet.
 *
 * Cupid deliberately has no legacy GamePhase binding. B4b uses the night timing
 * metadata below to prove a first-night-only role can be orchestrated without
 * adding `night_cupid` to the legacy domain state machine.
 */
export const CUPID_SPIKE_ROLE_DEFINITION: WerewolfRoleDefinition<
  CupidSpikeRoleId,
  CupidSpikeInteractionKind
> = {
  id: "cupid",
  name: "丘比特",
  description: "首夜选择两名玩家成为恋人；一名恋人死亡时，另一名恋人随之死亡。",
  team: "village",
  maxCount: 1,
  interaction: {
    night: { order: 5, schedule: "first_night_only" },
    kind: "cupid_link_lovers",
    mode: "single",
    wakePolicy: { vibrate: true },
    completionPolicy: { type: "single_submission" },
  },
  hooks: {
    afterDeath: ({ ruleState, deadPlayerId }) => {
      const linkedPlayerId = loverOf(ruleState, deadPlayerId);
      if (!linkedPlayerId) return [];
      return [{ type: "death", targetPlayerId: linkedPlayerId, cause: "ability" }];
    },
  },
};
