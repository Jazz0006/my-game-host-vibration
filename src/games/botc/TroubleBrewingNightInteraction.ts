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
    }
  | {
      kind: "fortune_teller_targets";
      targetPlayerIds: [string, string];
    };

function requireDistinctTargets(
  selectedPlayerIds: readonly string[],
  allowedPlayerIds: readonly string[],
  count: number,
): string[] {
  if (selectedPlayerIds.length !== count) {
    throw new Error(`This BotC night action requires exactly ${count} players`);
  }
  if (new Set(selectedPlayerIds).size !== selectedPlayerIds.length) {
    throw new Error("This BotC night action requires distinct players");
  }
  for (const playerId of selectedPlayerIds) {
    if (!allowedPlayerIds.includes(playerId)) {
      throw new Error("Selected player is not a legal target");
    }
  }
  return [...selectedPlayerIds];
}

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

    case "fortune_teller":
      return {
        kind: "player_targets",
        minTargets: 2,
        maxTargets: 2,
        allowedPlayerIds: [...participantPlayerIds],
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

  if (step.kind !== "role") {
    throw new Error("Active BotC night step is not a role choice");
  }

  switch (step.roleId) {
    case "poisoner": {
      const targetPlayerId = requireSingleTarget(
        selectedPlayerIds,
        spec.allowedPlayerIds,
      );
      return {
        kind: "poisoner_target",
        targetPlayerId,
        appliesEffect: step.actorSource === "actual",
      };
    }

    case "butler": {
      const targetPlayerId = requireSingleTarget(
        selectedPlayerIds,
        spec.allowedPlayerIds,
      );
      return {
        kind: "butler_master",
        targetPlayerId,
        appliesEffect: step.actorSource === "actual",
      };
    }

    case "fortune_teller": {
      const targets = requireDistinctTargets(
        selectedPlayerIds,
        spec.allowedPlayerIds,
        2,
      );
      return {
        kind: "fortune_teller_targets",
        targetPlayerIds: targets as [string, string],
      };
    }

    default:
      throw new Error("Active BotC night step has no supported choice resolver");
  }
}
