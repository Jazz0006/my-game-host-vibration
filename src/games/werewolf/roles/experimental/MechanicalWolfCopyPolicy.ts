import type { GameState } from "../../../../domain/game.js";
import type {
  WerewolfDeathCause,
  WerewolfInteractionEffect,
} from "../RoleDefinition.js";
import {
  abilityResourceFor,
  abilitySourceFor,
  addAbilityResource,
  spendAbilityResource,
  type WerewolfRuleState,
} from "../WerewolfRuleState.js";

export type MechanicalWolfCopiedResourcePolicy = {
  key: string;
  initialUses: number;
};

export type MechanicalWolfCopiedInteractionPolicy<TInteractionKind extends string = string> = {
  type: "interaction";
  interactionKind: TInteractionKind;
  resource?: MechanicalWolfCopiedResourcePolicy;
};

export type MechanicalWolfCopiedSelfDeathPolicy<TInteractionKind extends string = string> = {
  type: "self_death_interaction";
  interactionKind: TInteractionKind;
  allowedCauses: readonly WerewolfDeathCause[];
};

export type MechanicalWolfCopyCapability<TInteractionKind extends string = string> =
  | MechanicalWolfCopiedInteractionPolicy<TInteractionKind>
  | MechanicalWolfCopiedSelfDeathPolicy<TInteractionKind>;

export type MechanicalWolfCopyPolicy<TInteractionKind extends string = string> = {
  sourceRoleId: string;
  capabilities: readonly MechanicalWolfCopyCapability<TInteractionKind>[];
};

export type MechanicalWolfCopyPolicyRegistry<TInteractionKind extends string = string> = Readonly<
  Record<string, MechanicalWolfCopyPolicy<TInteractionKind>>
>;

/**
 * B5.1 fixture policies. These are deliberately separate from RoleDefinition:
 * role rules describe the source role itself; copy policy describes which parts
 * Mechanical Wolf is allowed to inherit and how copied semantics differ.
 */
export const MECHANICAL_WOLF_COPY_POLICIES: MechanicalWolfCopyPolicyRegistry = {
  seer: {
    sourceRoleId: "seer",
    capabilities: [{ type: "interaction", interactionKind: "seer_check" }],
  },
  witch: {
    sourceRoleId: "witch",
    capabilities: [
      {
        type: "interaction",
        interactionKind: "mechanical_wolf_poison",
        resource: { key: "copied_witch_poison", initialUses: 1 },
      },
    ],
  },
  hunter: {
    sourceRoleId: "hunter",
    capabilities: [
      {
        type: "self_death_interaction",
        interactionKind: "hunter_shot",
        allowedCauses: ["night_attack", "day_elimination"],
      },
    ],
  },
  villager: {
    sourceRoleId: "villager",
    capabilities: [],
  },
};

export function copyPolicyFor<TInteractionKind extends string>(
  sourceRoleId: string,
  registry: MechanicalWolfCopyPolicyRegistry<TInteractionKind>,
): MechanicalWolfCopyPolicy<TInteractionKind> | undefined {
  return registry[sourceRoleId];
}

/** Initializes only resources explicitly owned by copied capabilities. */
export function initializeMechanicalWolfCopiedResources<TInteractionKind extends string>(
  ruleState: WerewolfRuleState,
  ownerPlayerId: string,
  registry: MechanicalWolfCopyPolicyRegistry<TInteractionKind>,
): void {
  const source = abilitySourceFor(ruleState, ownerPlayerId);
  if (!source) throw new Error("机械狼尚未学习能力");
  const policy = copyPolicyFor(source.sourceRoleId, registry);
  if (!policy) return;

  for (const capability of policy.capabilities) {
    if (capability.type !== "interaction" || !capability.resource) continue;
    if (abilityResourceFor(ruleState, ownerPlayerId, capability.resource.key)) continue;
    addAbilityResource(ruleState, {
      ownerPlayerId,
      key: capability.resource.key,
      remainingUses: capability.resource.initialUses,
    });
  }
}

export function availableMechanicalWolfCopiedInteractions<TInteractionKind extends string>(
  ruleState: WerewolfRuleState,
  ownerPlayerId: string,
  currentNightNumber: number,
  registry: MechanicalWolfCopyPolicyRegistry<TInteractionKind>,
): readonly MechanicalWolfCopiedInteractionPolicy<TInteractionKind>[] {
  const source = abilitySourceFor(ruleState, ownerPlayerId);
  if (!source || currentNightNumber < source.availableFromNightNumber) return [];
  const policy = copyPolicyFor(source.sourceRoleId, registry);
  if (!policy) return [];

  return policy.capabilities.filter(
    (capability): capability is MechanicalWolfCopiedInteractionPolicy<TInteractionKind> => {
      if (capability.type !== "interaction") return false;
      if (!capability.resource) return true;
      return (
        abilityResourceFor(ruleState, ownerPlayerId, capability.resource.key)?.remainingUses ?? 0
      ) > 0;
    },
  );
}

export function consumeMechanicalWolfCopiedInteraction<TInteractionKind extends string>(
  ruleState: WerewolfRuleState,
  ownerPlayerId: string,
  currentNightNumber: number,
  interactionKind: TInteractionKind,
  registry: MechanicalWolfCopyPolicyRegistry<TInteractionKind>,
): void {
  const capability = availableMechanicalWolfCopiedInteractions(
    ruleState,
    ownerPlayerId,
    currentNightNumber,
    registry,
  ).find(item => item.interactionKind === interactionKind);
  if (!capability) throw new Error("该复制技能当前不可用");
  if (capability.resource) {
    spendAbilityResource(ruleState, ownerPlayerId, capability.resource.key);
  }
}

/**
 * Resolves only explicitly copyable self-death capabilities. It does not invoke
 * or delegate the source role's full lifecycle hook bundle.
 *
 * Like the production Hunter rule, a shot interaction is emitted only when
 * another living player exists. The dying owner is excluded explicitly because
 * death-chain evaluation may run before the owner is added to deadPlayerIds.
 */
export function resolveMechanicalWolfCopiedSelfDeathEffects<TInteractionKind extends string>(
  game: GameState,
  ruleState: WerewolfRuleState,
  ownerPlayerId: string,
  deadPlayerId: string,
  cause: WerewolfDeathCause,
  registry: MechanicalWolfCopyPolicyRegistry<TInteractionKind>,
): readonly WerewolfInteractionEffect<TInteractionKind>[] {
  if (ownerPlayerId !== deadPlayerId) return [];
  const hasLivingTarget = Object.keys(game.roles).some(
    playerId => playerId !== ownerPlayerId && !game.deadPlayerIds.includes(playerId),
  );
  if (!hasLivingTarget) return [];

  const source = abilitySourceFor(ruleState, ownerPlayerId);
  if (!source) return [];
  const policy = copyPolicyFor(source.sourceRoleId, registry);
  if (!policy) return [];

  return policy.capabilities.flatMap(capability => {
    if (capability.type !== "self_death_interaction") return [];
    if (!capability.allowedCauses.includes(cause)) return [];
    return [
      {
        type: "interaction" as const,
        kind: capability.interactionKind,
        actorPlayerId: ownerPlayerId,
      },
    ];
  });
}
