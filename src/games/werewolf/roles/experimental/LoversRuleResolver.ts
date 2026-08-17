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

export type LoversBaseTeamResolver = (playerId: string) => WerewolfTeam | undefined;

function staticTeamResolver<TRoleId extends string>(
  game: GameState,
  registry: LoversRoleRegistryLike<TRoleId>,
): LoversBaseTeamResolver {
  return playerId => {
    const roleId = game.roles[playerId];
    if (!roleId) return undefined;
    return registry[roleId]?.team;
  };
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
 *
 * Callers may provide a base-team resolver so relationship rules compose with
 * role-level dynamic alignment (for example future transformation/copy rules).
 */
export function resolveLoversEffectiveTeam<TRoleId extends string>(
  game: GameState,
  playerId: string,
  registry: LoversRoleRegistryLike<TRoleId>,
  ruleState: WerewolfRuleState,
  resolveBaseTeam: LoversBaseTeamResolver = staticTeamResolver(game, registry),
): WerewolfTeam | undefined {
  const ownTeam = resolveBaseTeam(playerId);
  if (!ownTeam) return undefined;

  const relationship = loversRelationshipFor(ruleState, playerId);
  if (!relationship) return ownTeam;

  const [leftPlayerId, rightPlayerId] = relationship.playerIds;
  const leftTeam = resolveBaseTeam(leftPlayerId);
  const rightTeam = resolveBaseTeam(rightPlayerId);

  return isClassicMixedPair(leftTeam, rightTeam) ? "lovers" : ownTeam;
}

/**
 * Applies the classic Cupid mixed-couple victory override.
 *
 * While both members of a mixed wolf/villager pair are alive, ordinary faction
 * victory is suspended: the wolf lover no longer wins merely because wolves
 * reach parity. The pair wins only when they are the final two living players.
 * Once the mixed pair is broken, normal faction victory is allowed again.
 */
export function resolveLoversVictory<TRoleId extends string>(
  game: GameState,
  defaultWinner: WerewolfWinner | null,
  registry: LoversRoleRegistryLike<TRoleId>,
  ruleState: WerewolfRuleState,
  resolveBaseTeam: LoversBaseTeamResolver = staticTeamResolver(game, registry),
): WerewolfWinner | null {
  for (const relationship of ruleState.relationships) {
    if (relationship.kind !== "lovers") continue;

    const [leftPlayerId, rightPlayerId] = relationship.playerIds;
    const leftTeam = resolveBaseTeam(leftPlayerId);
    const rightTeam = resolveBaseTeam(rightPlayerId);
    if (!isClassicMixedPair(leftTeam, rightTeam)) continue;

    const bothAlive =
      !game.deadPlayerIds.includes(leftPlayerId) &&
      !game.deadPlayerIds.includes(rightPlayerId);
    if (!bothAlive) continue;

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

    return null;
  }

  return defaultWinner;
}
