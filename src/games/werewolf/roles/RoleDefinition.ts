import type {
  InteractionCompletionPolicy,
  InteractionMode,
  InteractionWakePolicy,
} from "../../../core/interaction/PendingInteraction.js";
import type { GamePhase, GameState } from "../../../domain/game.js";

export type WerewolfTeam = "village" | "wolf" | "neutral";
export type WerewolfDeathCause = "night_attack" | "poison" | "day_elimination" | "ability";
export type WerewolfWinner = "wolf" | "village";

export type WerewolfRoleRuleContext<TRoleId extends string = string> = {
  game: GameState;
  rolePlayerId: string;
  roleId: TRoleId;
};

export type WerewolfDeathRuleContext<TRoleId extends string = string> =
  WerewolfRoleRuleContext<TRoleId> & {
    deadPlayerId: string;
    cause: WerewolfDeathCause;
  };

export type WerewolfTriggeredAction<TInteractionKind extends string = string> = {
  kind: TInteractionKind;
  actorPlayerId: string;
};

/**
 * Focused lifecycle hooks for roles whose rules do more than expose a normal
 * interaction. Hooks stay pure and transport-neutral: they inspect game state
 * and return decisions, but never mutate sockets, sessions, rooms or clients.
 *
 * Death hooks are evaluated for every assigned role, not only the dying role.
 * This leaves room for future protector/lover-style mechanics without turning
 * the contract into a generic rules DSL.
 */
export type WerewolfRoleRuleHooks<
  TRoleId extends string = string,
  TInteractionKind extends string = string,
> = {
  beforeDeath?: (
    context: WerewolfDeathRuleContext<TRoleId>,
  ) => { preventDeath: boolean; reason?: string } | undefined;
  afterDeath?: (
    context: WerewolfDeathRuleContext<TRoleId>,
  ) => readonly WerewolfTriggeredAction<TInteractionKind>[];
  resolveTeam?: (context: WerewolfRoleRuleContext<TRoleId>) => WerewolfTeam;
  evaluateVictory?: (
    context: WerewolfRoleRuleContext<TRoleId> & { defaultWinner: WerewolfWinner | null },
  ) => WerewolfWinner | null | undefined;
};

export type WerewolfRoleInteractionDefinition<TKind extends string = string> = {
  phase: GamePhase;
  kind: TKind;
  mode: InteractionMode;
  wakePolicy: InteractionWakePolicy;
  completionPolicy: InteractionCompletionPolicy;
  /**
   * Optional eligibility hook for role-specific resource/trigger rules.
   * Actor liveness is handled by the planner before this hook runs.
   */
  isEnabled?: (game: GameState) => boolean;
  /**
   * Hunter-style interactions can be triggered after the actor has died.
   * Normal night roles leave this false/undefined.
   */
  allowDeadActors?: boolean;
};

/**
 * Declarative role metadata used by scripts and orchestration.
 *
 * Normal roles can stay entirely declarative. Complex roles may opt into a
 * small set of pure lifecycle hooks without changing the generic planner.
 */
export type WerewolfRoleDefinition<
  TRoleId extends string = string,
  TInteractionKind extends string = string,
> = {
  id: TRoleId;
  name: string;
  description: string;
  team: WerewolfTeam;
  maxCount?: number;
  nightOrder?: number;
  interaction?: WerewolfRoleInteractionDefinition<TInteractionKind>;
  hooks?: WerewolfRoleRuleHooks<TRoleId, TInteractionKind>;
};
