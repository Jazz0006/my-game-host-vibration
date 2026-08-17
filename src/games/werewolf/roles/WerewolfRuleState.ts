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

export type WerewolfRuleState = {
  relationships: WerewolfRelationship[];
  abilitySources: WerewolfAbilitySource[];
};

export function createEmptyWerewolfRuleState(): WerewolfRuleState {
  return { relationships: [], abilitySources: [] };
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
