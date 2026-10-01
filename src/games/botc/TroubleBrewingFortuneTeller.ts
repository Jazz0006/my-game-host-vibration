import { troubleBrewingRole } from "./TroubleBrewing.js";
import {
  troubleBrewingCharacterRegistrations,
  type TroubleBrewingCharacterRegistration,
} from "./TroubleBrewingRegistration.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";

export type TroubleBrewingRedHerringSelectionSource = "moderator" | "baseline_v1";

export type TroubleBrewingFortuneTellerTargetResolution = {
  playerId: string;
  redHerringMatch: boolean;
  registration: TroubleBrewingCharacterRegistration;
  registersAsDemon: boolean;
};

export type TroubleBrewingFortuneTellerInformationResolution = {
  kind: "fortune_teller";
  selectedPlayerIds: [string, string];
  targets: [
    TroubleBrewingFortuneTellerTargetResolution,
    TroubleBrewingFortuneTellerTargetResolution,
  ];
};

export type TroubleBrewingFortuneTellerInformationCandidate = {
  candidateId: string;
  value: boolean;
  legalResolutions: TroubleBrewingFortuneTellerInformationResolution[];
};

export function createTroubleBrewingRedHerringCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
): string[] {
  return assignments
    .filter(
      assignment =>
        troubleBrewingRole(assignment.actualRoleId).alignment === "good",
    )
    .map(assignment => assignment.playerId)
    .sort((left, right) => left.localeCompare(right));
}

function targetResolutions(
  assignment: BotcCanonicalSetupAssignment,
  redHerringPlayerId: string,
): TroubleBrewingFortuneTellerTargetResolution[] {
  return troubleBrewingCharacterRegistrations(assignment).map(registration => {
    const registersAsDemon =
      troubleBrewingRole(registration.roleId).category === "demon";
    return {
      playerId: assignment.playerId,
      redHerringMatch: assignment.playerId === redHerringPlayerId,
      registration: { ...registration },
      registersAsDemon,
    };
  });
}

export function createTroubleBrewingFortuneTellerInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  selectedPlayerIds: readonly string[],
  redHerringPlayerId: string,
): TroubleBrewingFortuneTellerInformationCandidate[] {
  if (selectedPlayerIds.length !== 2) {
    throw new Error("Fortune Teller information requires exactly two players");
  }
  if (new Set(selectedPlayerIds).size !== selectedPlayerIds.length) {
    throw new Error("Fortune Teller information requires two distinct players");
  }

  const byPlayerId = new Map(
    assignments.map(assignment => [assignment.playerId, assignment] as const),
  );
  const selected = selectedPlayerIds.map(playerId => {
    const assignment = byPlayerId.get(playerId);
    if (!assignment) {
      throw new Error("Fortune Teller selected player is not in the game");
    }
    return assignment;
  });
  if (!createTroubleBrewingRedHerringCandidates(assignments).includes(redHerringPlayerId)) {
    throw new Error("Fortune Teller Red Herring must be an actual good player");
  }

  const firstOptions = targetResolutions(selected[0]!, redHerringPlayerId);
  const secondOptions = targetResolutions(selected[1]!, redHerringPlayerId);
  const grouped = new Map<boolean, TroubleBrewingFortuneTellerInformationCandidate>();

  for (const first of firstOptions) {
    for (const second of secondOptions) {
      const value =
        first.redHerringMatch ||
        second.redHerringMatch ||
        first.registersAsDemon ||
        second.registersAsDemon;
      const resolution: TroubleBrewingFortuneTellerInformationResolution = {
        kind: "fortune_teller",
        selectedPlayerIds: [...selectedPlayerIds] as [string, string],
        targets: [
          {
            ...first,
            registration: { ...first.registration },
          },
          {
            ...second,
            registration: { ...second.registration },
          },
        ],
      };
      const existing = grouped.get(value);
      if (existing) {
        existing.legalResolutions.push(resolution);
      } else {
        grouped.set(value, {
          candidateId: `fortune_teller:boolean:${value ? "yes" : "no"}`,
          value,
          legalResolutions: [resolution],
        });
      }
    }
  }

  return [...grouped.values()].sort(
    (left, right) => Number(left.value) - Number(right.value),
  );
}
