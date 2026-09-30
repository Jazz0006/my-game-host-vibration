import type { BotcNightStep } from "./TroubleBrewingNightSequence.js";

export type TroubleBrewingNightChoiceSpec = {
  kind: "player_targets";
  minTargets: number;
  maxTargets: number;
  allowedPlayerIds: string[];
};

export type TroubleBrewingNightChoiceResolution =
  | {
      kind: "poisoner_target";
      targetPlayerId: string;
      appliesEffect: boolean;
    }
  | {
      kind: "butler_master";
      targetPlayerId: string;
      appliesEffect: boolean;
    };

function requireSingleTarget(
  selectedPlayerIds: readonly string[],
  allowedPlayerIds: readonly string[],
): string {
  if (selectedPlayerIds.length !== 1) {
    throw new Error("This BotC night action requires exactly one player");
  }
  const targetPlayerId = selectedPlayerIds[0]!;
  if (!allowedPlayerIds.includes(targetPlayerId)) {
    throw new Error("Selected player is not a legal target");
  }
  return targetPlayerId;
}

/**
 * Defines player-input shape for the active canonical Trouble Brewing step.
 *
 * The client receives only this input contract. It never decides which role is
 * currently entitled to act or which targets are rules-legal.
 */
export function troubleBrewingNightChoiceSpec(
  step: BotcNightStep,
  actorPlayerId: string,
  participantPlayerIds: readonly string[],
): TroubleBrewingNightChoiceSpec | undefined {
  if (
    step.kind !== "role" ||
    !step.actorPlayerIds.includes(actorPlayerId)
  ) {
    return undefined;
  }

  switch (step.roleId) {
    case "poisoner":
      return {
        kind: "player_targets",
        minTargets: 1,
        maxTargets: 1,
        allowedPlayerIds: [...participantPlayerIds],
      };

    case "butler":
      return {
        kind: "player_targets",
        minTargets: 1,
        maxTargets: 1,
        allowedPlayerIds: participantPlayerIds.filter(
          playerId => playerId !== actorPlayerId,
        ),
      };

    default:
      return undefined;
  }
}

/**
 * Resolves a submitted choice against the active canonical step. Role effects
 * are committed only when the step is sourced from the actor's actual role;
 * presentation-only or transition-derived role identity must not mutate the
 * canonical Poisoner/Butler effect state.
 */
export function resolveTroubleBrewingNightChoice(
  step: BotcNightStep,
  actorPlayerId: string,
  participantPlayerIds: readonly string[],
  selectedPlayerIds: readonly string[],
): TroubleBrewingNightChoiceResolution {
  const spec = troubleBrewingNightChoiceSpec(
    step,
    actorPlayerId,
    participantPlayerIds,
  );
  if (!spec) {
    throw new Error("Active BotC night step does not accept this player choice");
  }

  const targetPlayerId = requireSingleTarget(
    selectedPlayerIds,
    spec.allowedPlayerIds,
  );
  const appliesEffect =
    step.kind === "role" && step.actorSource === "actual";

  if (step.kind !== "role") {
    throw new Error("Active BotC night step is not a role choice");
  }

  switch (step.roleId) {
    case "poisoner":
      return {
        kind: "poisoner_target",
        targetPlayerId,
        appliesEffect,
      };

    case "butler":
      return {
        kind: "butler_master",
        targetPlayerId,
        appliesEffect,
      };

    default:
      throw new Error("Active BotC night step has no supported choice resolver");
  }
}
