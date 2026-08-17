import type { WerewolfScriptDefinition } from "../ScriptDefinition.js";
import type { CupidSpikeRoleId } from "../../roles/experimental/CupidRoleDefinition.js";

/**
 * Architecture-only script used by B4b. It is not exposed by the production
 * script catalog or configuration UI.
 */
export const CUPID_DYNAMIC_ORCHESTRATION_SPIKE_SCRIPT: WerewolfScriptDefinition<CupidSpikeRoleId> = {
  id: "cupid-dynamic-orchestration-spike",
  name: "丘比特动态夜间编排测试",
  description: "验证新增首夜角色无需扩展 legacy GamePhase 或 NIGHT_ORDER。",
  roleDeck: [
    "cupid",
    "guard",
    "werewolf",
    "werewolf",
    "witch",
    "seer",
    "villager",
    "villager",
  ],
};
