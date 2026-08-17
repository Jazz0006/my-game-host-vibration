import type {
  InteractionCompletionPolicy,
  InteractionMode,
  InteractionWakePolicy,
} from "../../../core/interaction/PendingInteraction.js";
import type { GamePhase, GameState } from "../../../domain/game.js";

export type WerewolfTeam = "village" | "wolf" | "neutral";

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
 * Complex rules are intentionally not forced into JSON. Future roles that
 * alter deaths, alignment or victory can add focused hooks around this
 * contract without changing the generic interaction planner.
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
};
