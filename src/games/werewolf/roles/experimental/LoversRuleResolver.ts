import type { GameState } from "../../../../domain/game.js";
import type {
  WerewolfRoleDefinition,
  WerewolfTeam,
  WerewolfWinner,
} from "../RoleDefinition.js";
import type { WerewolfRuleState } from "../WerewolfRuleState.js";

export type LoversRoleRegistryLike<TRoleId extends string = string> = Readonly<
  Record<string, WerewolfRoleDefinition<TRoleId, string>>
>;

function baseTeamFor<TRoleId extends string>(
  game: GameState,
  playerId: string,
  registry: LoversRoleRegistryLike<TRoleId>,
): WerewolfTeam | undefined {
  const roleId = game.roles[playerId];
  if (!roleId) return undefined;
  return registry[roleId]?.team;
}

function isClassicMixedPair(left: WerewolfTeam | undefined, right: WerewolfTeam | undefined): boolean {
  return (left === "wolf" && right === "village") || (left === "village" && right === "wolf");
}

function loversRelationshipFor(ruleState: WerewolfRuleState, playerId: string) {
  return ruleState.relationships.find(
    relationship =>
      relationship.kind === "lovers" && relationship.playerIds.includes(playerId),
  );
}

/**
 * Resolves relationship-derived alignment without changing the player's role.
 * Same-team lovers retain their normal team. A classic wolf/villager mixed pair
 * becomes the special Lovers team for victory purposes.
 */
export function resolveLoversEffectiveTeam<TRoleId extends string>(
  game: GameState,
  playerId: string,
  registry: LoversRoleRegistryLike<TRoleId>,
  ruleState: WerewolfRuleState,
): WerewolfTeam | undefined {
  const ownTeam = baseTeamFor(game, playerId, registry);
  if (!ownTeam) return undefined;

  const relationship = loversRelationshipFor(ruleState, playerId);
  if (!relationship) return ownTeam;

  const [leftPlayerId, rightPlayerId] = relationship.playerIds;
  const leftTeam = baseTeamFor(game, leftPlayerId, registry);
  const rightTeam = baseTeamFor(game, rightPlayerId, registry);

  return isClassicMixedPair(leftTeam, rightTeam) ? "lovers" : ownTeam;
}

/**
 * Applies the classic Cupid mixed-couple victory override. The mixed pair wins
 * only when both Lovers are alive and every other player is dead. Same-team
 * Lovers do not replace their original faction's normal victory condition.
 */
export function resolveLoversVictory<TRoleId extends string>(
  game: GameState,
  defaultWinner: WerewolfWinner | null,
  registry: LoversRoleRegistryLike<TRoleId>,
  ruleState: WerewolfRuleState,
): WerewolfWinner | null {
  for (const relationship of ruleState.relationships) {
    if (relationship.kind !== "lovers") continue;

    const [leftPlayerId, rightPlayerId] = relationship.playerIds;
    const leftTeam = baseTeamFor(game, leftPlayerId, registry);
    const rightTeam = baseTeamFor(game, rightPlayerId, registry);
    if (!isClassicMixedPair(leftTeam, rightTeam)) continue;

    if (game.deadPlayerIds.includes(leftPlayerId) || game.deadPlayerIds.includes(rightPlayerId)) {
      continue;
    }

    const livingPlayerIds = Object.keys(game.roles).filter(
      playerId => !game.deadPlayerIds.includes(playerId),
    );
    if (
      livingPlayerIds.length === 2 &&
      livingPlayerIds.includes(leftPlayerId) &&
      livingPlayerIds.includes(rightPlayerId)
    ) {
      return "lovers";
    }
  }

  return defaultWinner;
}
