export type BotcRoleCategory = "townsfolk" | "outsider" | "minion" | "demon";
export type BotcAlignment = "good" | "evil";

export const TROUBLE_BREWING_SCRIPT_ID = "trouble-brewing" as const;

export const TROUBLE_BREWING_ROLES = [
  { id: "washerwoman", name: "Washerwoman", nameZh: "洗衣妇", category: "townsfolk" },
  { id: "librarian", name: "Librarian", nameZh: "图书管理员", category: "townsfolk" },
  { id: "investigator", name: "Investigator", nameZh: "调查员", category: "townsfolk" },
  { id: "chef", name: "Chef", nameZh: "厨师", category: "townsfolk" },
  { id: "empath", name: "Empath", nameZh: "共情者", category: "townsfolk" },
  { id: "fortune_teller", name: "Fortune Teller", nameZh: "占卜师", category: "townsfolk" },
  { id: "undertaker", name: "Undertaker", nameZh: "送葬者", category: "townsfolk" },
  { id: "monk", name: "Monk", nameZh: "僧侣", category: "townsfolk" },
  { id: "ravenkeeper", name: "Ravenkeeper", nameZh: "守鸦人", category: "townsfolk" },
  { id: "virgin", name: "Virgin", nameZh: "圣女", category: "townsfolk" },
  { id: "slayer", name: "Slayer", nameZh: "猎手", category: "townsfolk" },
  { id: "soldier", name: "Soldier", nameZh: "士兵", category: "townsfolk" },
  { id: "mayor", name: "Mayor", nameZh: "市长", category: "townsfolk" },
  { id: "butler", name: "Butler", nameZh: "管家", category: "outsider" },
  { id: "drunk", name: "Drunk", nameZh: "酒鬼", category: "outsider" },
  { id: "recluse", name: "Recluse", nameZh: "隐士", category: "outsider" },
  { id: "saint", name: "Saint", nameZh: "圣徒", category: "outsider" },
  { id: "poisoner", name: "Poisoner", nameZh: "投毒者", category: "minion" },
  { id: "spy", name: "Spy", nameZh: "间谍", category: "minion" },
  { id: "scarlet_woman", name: "Scarlet Woman", nameZh: "猩红女巫", category: "minion" },
  { id: "baron", name: "Baron", nameZh: "男爵", category: "minion" },
  { id: "imp", name: "Imp", nameZh: "小恶魔", category: "demon" },
] as const satisfies readonly {
  id: string;
  name: string;
  nameZh: string;
  category: BotcRoleCategory;
}[];

export type TroubleBrewingRoleId = typeof TROUBLE_BREWING_ROLES[number]["id"];

export type TroubleBrewingRoleDefinition = {
  id: TroubleBrewingRoleId;
  name: string;
  nameZh: string;
  category: BotcRoleCategory;
  alignment: BotcAlignment;
};

export type TroubleBrewingSetupCounts = Record<BotcRoleCategory, number>;

const BASE_COUNTS: Readonly<Record<number, TroubleBrewingSetupCounts>> = {
  5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
};

const definitions = new Map<TroubleBrewingRoleId, TroubleBrewingRoleDefinition>(
  TROUBLE_BREWING_ROLES.map(role => [
    role.id,
    {
      ...role,
      alignment: role.category === "minion" || role.category === "demon"
        ? "evil"
        : "good",
    },
  ]),
);

export function troubleBrewingRole(
  roleId: TroubleBrewingRoleId,
): TroubleBrewingRoleDefinition {
  const role = definitions.get(roleId);
  if (!role) throw new Error(`Unknown Trouble Brewing role: ${roleId}`);
  return role;
}

export function troubleBrewingBaseCounts(
  playerCount: number,
): TroubleBrewingSetupCounts {
  const counts = BASE_COUNTS[playerCount];
  if (!counts) {
    throw new Error("Trouble Brewing supports 5–15 non-Traveler players");
  }
  return { ...counts };
}

export function troubleBrewingExpectedCounts(
  playerCount: number,
  selectedRoles: readonly TroubleBrewingRoleId[],
): TroubleBrewingSetupCounts {
  const counts = troubleBrewingBaseCounts(playerCount);
  if (selectedRoles.includes("baron")) {
    if (counts.townsfolk < 2) {
      throw new Error("Baron setup requires at least two Townsfolk slots");
    }
    counts.townsfolk -= 2;
    counts.outsider += 2;
  }
  return counts;
}

export function isTroubleBrewingRoleId(value: unknown): value is TroubleBrewingRoleId {
  return typeof value === "string" && definitions.has(value as TroubleBrewingRoleId);
}
