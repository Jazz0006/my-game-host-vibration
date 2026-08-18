import type { WerewolfRoleDefinition } from "../RoleDefinition.js";

export const MECHANICAL_WOLF_SPIKE_ROLE_DEFINITION: WerewolfRoleDefinition<
  "mechanical_wolf",
  "mechanical_wolf_learn"
> = {
  id: "mechanical_wolf",
  name: "机械狼",
  description:
    "狼人阵营；与普通狼人身份分离，可在一局中学习一次其他玩家并获得其能力。B5 仅验证身份与能力来源分离。",
  team: "wolf",
  maxCount: 1,
};
