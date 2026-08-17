import type { WerewolfRoleDefinition } from "../RoleDefinition.js";
import { loverOf } from "../WerewolfRuleState.js";

export type CupidSpikeRoleId = "cupid" | "villager" | "werewolf";
export type CupidSpikeInteractionKind = "cupid_link_lovers";

/**
 * Architecture-spike definition only. This is intentionally not registered in
 * the production role catalog or script deck yet.
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
  hooks: {
    afterDeath: ({ ruleState, deadPlayerId }) => {
      const linkedPlayerId = loverOf(ruleState, deadPlayerId);
      if (!linkedPlayerId) return [];
      return [{ type: "death", targetPlayerId: linkedPlayerId, cause: "ability" }];
    },
  },
};
