import type { GameState } from "../../../domain/game.js";
import type {
  WerewolfDeathCause,
  WerewolfRoleDefinition,
  WerewolfTeam,
  WerewolfTriggeredAction,
  WerewolfWinner,
} from "./RoleDefinition.js";

export class WerewolfRoleHookConflictError extends Error {}

export type WerewolfRoleRegistryLike<
  TRoleId extends string = string,
  TInteractionKind extends string = string,
> = Readonly<Record<string, WerewolfRoleDefinition<TRoleId, TInteractionKind>>>;

function assignedDefinitions<TRoleId extends string, TInteractionKind extends string>(
  game: GameState,
  registry: WerewolfRoleRegistryLike<TRoleId, TInteractionKind>,
): Array<{
  rolePlayerId: string;
  roleId: TRoleId;
  definition: WerewolfRoleDefinition<TRoleId, TInteractionKind>;
}> {
  const result: Array<{
    rolePlayerId: string;
    roleId: TRoleId;
    definition: WerewolfRoleDefinition<TRoleId, TInteractionKind>;
  }> = [];

  for (const [rolePlayerId, rawRoleId] of Object.entries(game.roles)) {
    const definition = registry[rawRoleId];
    if (!definition) continue;
    result.push({
      rolePlayerId,
      roleId: definition.id,
      definition,
    });
  }

  return result;
}

export function shouldPreventWerewolfDeath<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  game: GameState,
  deadPlayerId: string,
  cause: WerewolfDeathCause,
  registry: WerewolfRoleRegistryLike<TRoleId, TInteractionKind>,
): { preventDeath: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const { rolePlayerId, roleId, definition } of assignedDefinitions(game, registry)) {
    const decision = definition.hooks?.beforeDeath?.({
      game,
      rolePlayerId,
      roleId,
      deadPlayerId,
      cause,
    });
    if (!decision?.preventDeath) continue;
    if (decision.reason) reasons.push(decision.reason);
  }

  return { preventDeath: reasons.length > 0, reasons };
}

export function collectWerewolfAfterDeathActions<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  game: GameState,
  deadPlayerId: string,
  cause: WerewolfDeathCause,
  registry: WerewolfRoleRegistryLike<TRoleId, TInteractionKind>,
): WerewolfTriggeredAction<TInteractionKind>[] {
  const actions: WerewolfTriggeredAction<TInteractionKind>[] = [];

  for (const { rolePlayerId, roleId, definition } of assignedDefinitions(game, registry)) {
    const triggered = definition.hooks?.afterDeath?.({
      game,
      rolePlayerId,
      roleId,
      deadPlayerId,
      cause,
    });
    if (triggered) actions.push(...triggered);
  }

  return actions;
}

export function resolveWerewolfEffectiveTeam<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  game: GameState,
  playerId: string,
  registry: WerewolfRoleRegistryLike<TRoleId, TInteractionKind>,
): WerewolfTeam | undefined {
  const rawRoleId = game.roles[playerId];
  if (!rawRoleId) return undefined;
  const definition = registry[rawRoleId];
  if (!definition) return undefined;

  return definition.hooks?.resolveTeam?.({
    game,
    rolePlayerId: playerId,
    roleId: definition.id,
  }) ?? definition.team;
}

export function resolveWerewolfVictoryOverride<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  game: GameState,
  defaultWinner: WerewolfWinner | null,
  registry: WerewolfRoleRegistryLike<TRoleId, TInteractionKind>,
): WerewolfWinner | null {
  const overrides: Array<WerewolfWinner | null> = [];

  for (const { rolePlayerId, roleId, definition } of assignedDefinitions(game, registry)) {
    const override = definition.hooks?.evaluateVictory?.({
      game,
      rolePlayerId,
      roleId,
      defaultWinner,
    });
    if (override !== undefined) overrides.push(override);
  }

  if (overrides.length === 0) return defaultWinner;

  const first = overrides[0]!;
  if (overrides.some(value => value !== first)) {
    throw new WerewolfRoleHookConflictError("角色胜负 hook 返回了互相冲突的结果");
  }
  return first;
}
