import type { GameState } from "../../../../domain/game.js";
import type {
  WerewolfRoleDefinition,
  WerewolfTeam,
  WerewolfWinner,
} from "../RoleDefinition.js";
import type { WerewolfRuleState, WerewolfLoversRelationship } from "../WerewolfRuleState.js";

export type LoversRoleRegistryLike<TRoleId extends string = string> = Readonly<
  Record<string, WerewolfRoleDefinition<TRoleId, string>>
>;

export type LoversBaseTeamResolver = (playerId: string) => WerewolfTeam | undefined;

export type CupidRuleVariant = "classic_millers_hollow" | "china_three_party";

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

function isMixedPair(left: WerewolfTeam | undefined, right: WerewolfTeam | undefined): boolean {
  return (left === "wolf" && right === "village") || (left === "village" && right === "wolf");
}

function loversRelationshipFor(ruleState: WerewolfRuleState, playerId: string) {
  return ruleState.relationships.find(
    relationship =>
      relationship.kind === "lovers" && relationship.playerIds.includes(playerId),
  );
}

function specialTeamMembers(
  relationship: WerewolfLoversRelationship,
  variant: CupidRuleVariant,
): Set<string> {
  const members = new Set<string>(relationship.playerIds);
  if (variant === "china_three_party") {
    members.add(relationship.sourceRolePlayerId);
  }
  return members;
}

function isSpecialTeamMember(
  relationship: WerewolfLoversRelationship,
  playerId: string,
  variant: CupidRuleVariant,
): boolean {
  return specialTeamMembers(relationship, variant).has(playerId);
}

/**
 * Resolves relationship-derived alignment without changing the player's role.
 *
 * Classic Miller's Hollow:
 * - a wolf/villager mixed pair becomes the special Lovers team;
 * - Cupid stays on their original team unless Cupid selected themself.
 *
 * China three-party variant:
 * - for a wolf/villager mixed pair, Cupid and both lovers share the special
 *   Lovers team, even when Cupid selected two other players.
 *
 * Same-team lovers retain their normal team in both variants.
 * Callers may provide a base-team resolver so relationship rules compose with
 * role-level dynamic alignment.
 */
export function resolveLoversEffectiveTeam<TRoleId extends string>(
  game: GameState,
  playerId: string,
  registry: LoversRoleRegistryLike<TRoleId>,
  ruleState: WerewolfRuleState,
  variant: CupidRuleVariant = "classic_millers_hollow",
  resolveBaseTeam: LoversBaseTeamResolver = staticTeamResolver(game, registry),
): WerewolfTeam | undefined {
  const ownTeam = resolveBaseTeam(playerId);
  if (!ownTeam) return undefined;

  for (const relationship of ruleState.relationships) {
    if (relationship.kind !== "lovers") continue;

    const [leftPlayerId, rightPlayerId] = relationship.playerIds;
    const leftTeam = resolveBaseTeam(leftPlayerId);
    const rightTeam = resolveBaseTeam(rightPlayerId);
    if (!isMixedPair(leftTeam, rightTeam)) continue;

    if (isSpecialTeamMember(relationship, playerId, variant)) return "lovers";
  }

  return ownTeam;
}

/**
 * Applies the configured mixed-couple victory override.
 *
 * While both lovers of a mixed wolf/villager pair are alive, ordinary faction
 * victory is suspended. The special team wins when every living player belongs
 * to that variant's special team:
 *
 * - classic_millers_hollow: the two lovers are the final living players;
 * - china_three_party: all remaining living players are among Cupid + the two
 *   lovers. Cupid may already be dead and still shares the eventual team win.
 *
 * Once either lover dies, normal faction victory is allowed again. The linked
 * death rule from B4 means the other lover will normally die in the same chain.
 */
export function resolveLoversVictory<TRoleId extends string>(
  game: GameState,
  defaultWinner: WerewolfWinner | null,
  registry: LoversRoleRegistryLike<TRoleId>,
  ruleState: WerewolfRuleState,
  variant: CupidRuleVariant = "classic_millers_hollow",
  resolveBaseTeam: LoversBaseTeamResolver = staticTeamResolver(game, registry),
): WerewolfWinner | null {
  for (const relationship of ruleState.relationships) {
    if (relationship.kind !== "lovers") continue;

    const [leftPlayerId, rightPlayerId] = relationship.playerIds;
    const leftTeam = resolveBaseTeam(leftPlayerId);
    const rightTeam = resolveBaseTeam(rightPlayerId);
    if (!isMixedPair(leftTeam, rightTeam)) continue;

    const bothLoversAlive =
      !game.deadPlayerIds.includes(leftPlayerId) &&
      !game.deadPlayerIds.includes(rightPlayerId);
    if (!bothLoversAlive) continue;

    const members = specialTeamMembers(relationship, variant);
    const livingPlayerIds = Object.keys(game.roles).filter(
      playerId => !game.deadPlayerIds.includes(playerId),
    );

    if (livingPlayerIds.every(playerId => members.has(playerId))) {
      return "lovers";
    }

    return null;
  }

  return defaultWinner;
}
