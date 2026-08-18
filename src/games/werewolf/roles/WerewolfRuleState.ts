export type WerewolfLoversRelationship = {
  id: string;
  kind: "lovers";
  sourceRolePlayerId: string;
  playerIds: readonly [string, string];
};

export type WerewolfRelationship = WerewolfLoversRelationship;

/**
 * Serializable record of a role ability learned or delegated to another player.
 *
 * The owner keeps their assigned role and team. `sourceRoleId` identifies the
 * role whose ability package is being borrowed; `sourcePlayerId` is retained for
 * audit/debug/snapshot purposes and must not be used as the acting player.
 */
export type WerewolfAbilitySource = {
  ownerPlayerId: string;
  sourcePlayerId: string;
  sourceRoleId: string;
  learnedNightNumber: number;
  availableFromNightNumber: number;
};

/** Serializable resource owned by a delegated/copied ability. */
export type WerewolfAbilityResource = {
  ownerPlayerId: string;
  key: string;
  remainingUses: number;
};

export type WerewolfRuleState = {
  relationships: WerewolfRelationship[];
  abilitySources: WerewolfAbilitySource[];
  abilityResources: WerewolfAbilityResource[];
};

export function createEmptyWerewolfRuleState(): WerewolfRuleState {
  return { relationships: [], abilitySources: [], abilityResources: [] };
}

export function addLoversRelationship(
  state: WerewolfRuleState,
  relationship: WerewolfLoversRelationship,
): void {
  const [left, right] = relationship.playerIds;
  if (left === right) throw new Error("恋人必须是两名不同玩家");
  if (state.relationships.some(item => item.id === relationship.id)) {
    throw new Error(`重复的关系 id: ${relationship.id}`);
  }
  if (
    state.relationships.some(
      item => item.kind === "lovers" && item.playerIds.some(playerId => playerId === left || playerId === right),
    )
  ) {
    throw new Error("玩家不能同时属于多组恋人关系");
  }
  state.relationships.push(relationship);
}

export function loverOf(state: WerewolfRuleState, playerId: string): string | undefined {
  for (const relationship of state.relationships) {
    if (relationship.kind !== "lovers") continue;
    const [left, right] = relationship.playerIds;
    if (left === playerId) return right;
    if (right === playerId) return left;
  }
  return undefined;
}

export function addAbilitySource(
  state: WerewolfRuleState,
  abilitySource: WerewolfAbilitySource,
): void {
  if (state.abilitySources.some(item => item.ownerPlayerId === abilitySource.ownerPlayerId)) {
    throw new Error("同一玩家只能拥有一个已学习的能力来源");
  }
  if (!Number.isInteger(abilitySource.learnedNightNumber) || abilitySource.learnedNightNumber < 1) {
    throw new Error("学习夜数无效");
  }
  if (
    !Number.isInteger(abilitySource.availableFromNightNumber) ||
    abilitySource.availableFromNightNumber < abilitySource.learnedNightNumber
  ) {
    throw new Error("能力生效夜数无效");
  }
  state.abilitySources.push(abilitySource);
}

export function abilitySourceFor(
  state: WerewolfRuleState,
  ownerPlayerId: string,
): WerewolfAbilitySource | undefined {
  return state.abilitySources.find(item => item.ownerPlayerId === ownerPlayerId);
}

export function addAbilityResource(
  state: WerewolfRuleState,
  resource: WerewolfAbilityResource,
): void {
  if (!Number.isInteger(resource.remainingUses) || resource.remainingUses < 0) {
    throw new Error("能力资源次数无效");
  }
  if (
    state.abilityResources.some(
      item => item.ownerPlayerId === resource.ownerPlayerId && item.key === resource.key,
    )
  ) {
    throw new Error(`重复的能力资源: ${resource.key}`);
  }
  state.abilityResources.push(resource);
}

export function abilityResourceFor(
  state: WerewolfRuleState,
  ownerPlayerId: string,
  key: string,
): WerewolfAbilityResource | undefined {
  return state.abilityResources.find(
    item => item.ownerPlayerId === ownerPlayerId && item.key === key,
  );
}

export function spendAbilityResource(
  state: WerewolfRuleState,
  ownerPlayerId: string,
  key: string,
): void {
  const resource = abilityResourceFor(state, ownerPlayerId, key);
  if (!resource || resource.remainingUses <= 0) {
    throw new Error(`能力资源已耗尽: ${key}`);
  }
  resource.remainingUses -= 1;
}
