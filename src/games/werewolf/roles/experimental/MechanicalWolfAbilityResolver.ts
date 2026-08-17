import type { GameState } from "../../../../domain/game.js";
import type {
  WerewolfRoleDefinition,
  WerewolfRoleInteractionDefinition,
  WerewolfTeam,
} from "../RoleDefinition.js";
import {
  abilitySourceFor,
  addAbilitySource,
  type WerewolfAbilitySource,
  type WerewolfRuleState,
} from "../WerewolfRuleState.js";

export type MechanicalWolfSpikeRoleId = "mechanical_wolf";

export type AbilitySourceRegistryLike<TRoleId extends string = string, TInteractionKind extends string = string> =
  Readonly<Record<string, WerewolfRoleDefinition<TRoleId, TInteractionKind>>>;

/**
 * A copied ability deliberately omits source-role scheduling fields such as
 * `phase` and `nightOrder`. The owner must be scheduled by its own role/ruleset.
 */
export type BorrowedInteractionAbility<TInteractionKind extends string = string> = Pick<
  WerewolfRoleInteractionDefinition<TInteractionKind>,
  "kind" | "mode" | "wakePolicy" | "completionPolicy" | "isEnabled" | "allowDeadActors"
>;

export type MechanicalWolfAbilityProfile<TInteractionKind extends string = string> = {
  assignedRoleId: string;
  effectiveTeam: WerewolfTeam;
  abilitySource?: WerewolfAbilitySource;
  perceivedRoleId: string;
  borrowedInteraction?: BorrowedInteractionAbility<TInteractionKind>;
};

/**
 * Records the one-time learning choice. The target's role is snapshotted at the
 * moment of learning so later role/team changes do not silently rewrite what was learned.
 *
 * Most commonly documented Mechanical Wolf implementations activate copied
 * non-death abilities on the following night. B5 models that as the default
 * delay while keeping the delay explicit for ruleset-specific follow-up work.
 */
export function learnMechanicalWolfAbility(
  game: GameState,
  ruleState: WerewolfRuleState,
  mechanicalWolfPlayerId: string,
  targetPlayerId: string,
  activationDelayNights = 1,
): WerewolfAbilitySource {
  if (abilitySourceFor(ruleState, mechanicalWolfPlayerId)) {
    throw new Error("机械狼整局只能学习一次");
  }
  if (mechanicalWolfPlayerId === targetPlayerId) {
    throw new Error("机械狼不能学习自己");
  }
  const sourceRoleId = game.roles[targetPlayerId];
  if (!sourceRoleId) throw new Error("学习目标不是有效玩家");
  if (!Number.isInteger(activationDelayNights) || activationDelayNights < 0) {
    throw new Error("能力生效延迟无效");
  }

  const source: WerewolfAbilitySource = {
    ownerPlayerId: mechanicalWolfPlayerId,
    sourcePlayerId: targetPlayerId,
    sourceRoleId,
    learnedNightNumber: game.nightNumber,
    availableFromNightNumber: game.nightNumber + activationDelayNights,
  };
  addAbilitySource(ruleState, source);
  return source;
}

function projectBorrowedInteraction<TInteractionKind extends string>(
  interaction: WerewolfRoleInteractionDefinition<TInteractionKind> | undefined,
): BorrowedInteractionAbility<TInteractionKind> | undefined {
  if (!interaction) return undefined;
  return {
    kind: interaction.kind,
    mode: interaction.mode,
    wakePolicy: interaction.wakePolicy,
    completionPolicy: interaction.completionPolicy,
    ...(interaction.isEnabled ? { isEnabled: interaction.isEnabled } : {}),
    ...(interaction.allowDeadActors ? { allowDeadActors: true } : {}),
  };
}

/**
 * Separates four concepts that are intentionally not equivalent:
 *
 * 1. assignedRoleId: the player's real role remains Mechanical Wolf;
 * 2. effectiveTeam: Mechanical Wolf remains on the wolf team;
 * 3. abilitySource: the role whose ability was learned;
 * 4. perceivedRoleId: role presented to role-specific identity checks after learning.
 */
export function resolveMechanicalWolfAbilityProfile<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  game: GameState,
  ruleState: WerewolfRuleState,
  mechanicalWolfPlayerId: string,
  registry: AbilitySourceRegistryLike<TRoleId, TInteractionKind>,
  mechanicalWolfTeam: WerewolfTeam = "wolf",
): MechanicalWolfAbilityProfile<TInteractionKind> {
  const assignedRoleId = game.roles[mechanicalWolfPlayerId];
  if (!assignedRoleId) throw new Error("机械狼玩家不存在");

  const source = abilitySourceFor(ruleState, mechanicalWolfPlayerId);
  if (!source) {
    return {
      assignedRoleId,
      effectiveTeam: mechanicalWolfTeam,
      perceivedRoleId: assignedRoleId,
    };
  }

  const sourceDefinition = registry[source.sourceRoleId];
  const abilityIsAvailable = game.nightNumber >= source.availableFromNightNumber;

  return {
    assignedRoleId,
    effectiveTeam: mechanicalWolfTeam,
    abilitySource: source,
    perceivedRoleId: source.sourceRoleId,
    ...(abilityIsAvailable && sourceDefinition?.interaction
      ? { borrowedInteraction: projectBorrowedInteraction(sourceDefinition.interaction) }
      : {}),
  };
}
