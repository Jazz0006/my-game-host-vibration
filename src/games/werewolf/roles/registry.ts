import type { GameState, Role } from "../../../domain/game.js";
import type { WerewolfRoleDefinition } from "./RoleDefinition.js";

export type WerewolfInteractionKind =
  | "wolf_kill"
  | "guard_protect"
  | "witch_action"
  | "seer_check"
  | "hunter_shot";

function witchCanAct(game: GameState): boolean {
  const canUseAntidote = !game.witchAntidoteSpent && Boolean(game.wolfTargetId);
  const canUsePoison = !game.witchPoisonSpent;
  return canUseAntidote || canUsePoison;
}

export const WEREWOLF_ROLE_REGISTRY: Record<
  Role,
  WerewolfRoleDefinition<Role, WerewolfInteractionKind>
> = {
  werewolf: {
    id: "werewolf",
    name: "狼人",
    description: "夜间可以击杀任意一名存活玩家（包括狼人）或选择空刀。",
    team: "wolf",
    nightOrder: 20,
    interaction: {
      phase: "night_werewolf",
      kind: "wolf_kill",
      mode: "group",
      wakePolicy: { vibrate: true, audioCue: "wolf_wake" },
      completionPolicy: { type: "any_actor_submission" },
    },
  },
  seer: {
    id: "seer",
    name: "预言家",
    description: "每晚可以查验一名其他玩家的阵营。",
    team: "village",
    maxCount: 1,
    nightOrder: 40,
    interaction: {
      phase: "night_seer",
      kind: "seer_check",
      mode: "single",
      wakePolicy: { vibrate: true },
      completionPolicy: { type: "explicit_confirmation" },
    },
  },
  witch: {
    id: "witch",
    name: "女巫",
    description: "拥有一瓶解药和一瓶毒药，同一晚只能使用一瓶。",
    team: "village",
    maxCount: 1,
    nightOrder: 30,
    interaction: {
      phase: "night_witch",
      kind: "witch_action",
      mode: "single",
      wakePolicy: { vibrate: true },
      completionPolicy: { type: "single_submission" },
      isEnabled: witchCanAct,
    },
  },
  guard: {
    id: "guard",
    name: "守卫",
    description: "每晚可以保护一名玩家（包括自己）或空守，但不能连续两晚保护同一人。",
    team: "village",
    maxCount: 1,
    nightOrder: 10,
    interaction: {
      phase: "night_guard",
      kind: "guard_protect",
      mode: "single",
      wakePolicy: { vibrate: true },
      completionPolicy: { type: "single_submission" },
    },
  },
  hunter: {
    id: "hunter",
    name: "猎人",
    description: "被狼刀或放逐出局时可以开枪带走一人，也可以不开枪；被毒死不能开枪。",
    team: "village",
    maxCount: 1,
    interaction: {
      phase: "day_hunter",
      kind: "hunter_shot",
      mode: "single",
      wakePolicy: { vibrate: true },
      completionPolicy: { type: "single_submission" },
      allowDeadActors: true,
    },
  },
  villager: {
    id: "villager",
    name: "平民",
    description: "没有夜间技能，请观察发言并找出狼人。",
    team: "village",
  },
};

export function getWerewolfRoleDefinition(role: Role) {
  return WEREWOLF_ROLE_REGISTRY[role];
}

export function orderedNightRoles(): Role[] {
  return Object.values(WEREWOLF_ROLE_REGISTRY)
    .filter(definition => definition.nightOrder !== undefined)
    .sort((left, right) => (left.nightOrder ?? 0) - (right.nightOrder ?? 0))
    .map(definition => definition.id);
}
