export type WerewolfLoversRelationship = {
  id: string;
  kind: "lovers";
  sourceRolePlayerId: string;
  playerIds: readonly [string, string];
};

export type WerewolfRelationship = WerewolfLoversRelationship;

export type WerewolfRuleState = {
  relationships: WerewolfRelationship[];
};

export function createEmptyWerewolfRuleState(): WerewolfRuleState {
  return { relationships: [] };
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
