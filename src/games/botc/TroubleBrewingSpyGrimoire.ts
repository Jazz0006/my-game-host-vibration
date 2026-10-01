import type { TroubleBrewingRoleId } from "./TroubleBrewing.js";
import {
  createTroubleBrewingPairInformationCandidates,
  isTroubleBrewingPairCandidate,
  type TroubleBrewingInformationReliability,
  type TroubleBrewingPairInformationAbilityRoleId,
} from "./TroubleBrewingInformation.js";
import {
  createPairInformationRecommendationRequest,
  recommendPairInformationBaselineV1,
} from "./TroubleBrewingRecommendation.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";

export type TroubleBrewingSpyGrimoirePlayer = {
  playerId: string;
  actualRoleId: TroubleBrewingRoleId;
  shownRoleId: TroubleBrewingRoleId;
  alive: boolean;
};

export type TroubleBrewingSpyPairInformationReminder =
  | {
      kind: "pair";
      abilityRoleId: TroubleBrewingPairInformationAbilityRoleId;
      recipientPlayerId: string;
      learnedRoleId: TroubleBrewingRoleId;
      shownPlayerIds: [string, string];
    }
  | {
      kind: "no_characters";
      abilityRoleId: "librarian";
      recipientPlayerId: string;
      noCharacterCategory: "outsider";
    };

export type TroubleBrewingSpyGrimoireSnapshot = {
  players: TroubleBrewingSpyGrimoirePlayer[];
  reminders: {
    drunkPlayerId?: string;
    poisonedPlayerId?: string;
    butlerMasterPlayerId?: string;
    redHerringPlayerId?: string;
    pairInformation: TroubleBrewingSpyPairInformationReminder[];
  };
};

export type TroubleBrewingSpyGrimoireFacts = {
  assignments: readonly BotcCanonicalSetupAssignment[];
  seatingPlayerIds: readonly string[];
  deadPlayerIds: readonly string[];
  poisonedPlayerId?: string;
  butlerMasterPlayerId?: string;
  redHerringPlayerId?: string;
  includeFirstNightPairInformation: boolean;
};

function pairInformationRecipient(
  assignments: readonly BotcCanonicalSetupAssignment[],
  abilityRoleId: TroubleBrewingPairInformationAbilityRoleId,
): { playerId: string; reliability: TroubleBrewingInformationReliability } | undefined {
  const actual = assignments.find(
    assignment => assignment.actualRoleId === abilityRoleId,
  );
  if (actual) {
    return { playerId: actual.playerId, reliability: "reliable" };
  }
  const shownDrunk = assignments.find(
    assignment =>
      assignment.actualRoleId === "drunk" &&
      assignment.shownRoleId === abilityRoleId,
  );
  return shownDrunk
    ? { playerId: shownDrunk.playerId, reliability: "drunk" }
    : undefined;
}

function firstNightPairInformationReminders(
  facts: TroubleBrewingSpyGrimoireFacts,
): TroubleBrewingSpyPairInformationReminder[] {
  if (!facts.includeFirstNightPairInformation) return [];

  const reminders: TroubleBrewingSpyPairInformationReminder[] = [];
  for (const abilityRoleId of [
    "washerwoman",
    "librarian",
    "investigator",
  ] as const satisfies readonly TroubleBrewingPairInformationAbilityRoleId[]) {
    const recipient = pairInformationRecipient(facts.assignments, abilityRoleId);
    if (!recipient) continue;

    const reliability =
      recipient.reliability === "drunk"
        ? "drunk"
        : facts.poisonedPlayerId === recipient.playerId
          ? "poisoned"
          : "reliable";
    const legalCandidates = createTroubleBrewingPairInformationCandidates(
      facts.assignments,
      abilityRoleId,
      recipient.playerId,
    );
    const request = createPairInformationRecommendationRequest(
      abilityRoleId,
      recipient.playerId,
      reliability,
      legalCandidates,
    );
    const recommendation = recommendPairInformationBaselineV1(request);
    const selected = legalCandidates.find(
      candidate => candidate.candidateId === recommendation.candidateId,
    );
    if (!selected) {
      throw new Error("Spy Grimoire preview selected a missing pair-information candidate");
    }

    if (isTroubleBrewingPairCandidate(selected)) {
      reminders.push({
        kind: "pair",
        abilityRoleId,
        recipientPlayerId: recipient.playerId,
        learnedRoleId: selected.learnedRoleId,
        shownPlayerIds: [...selected.shownPlayerIds] as [string, string],
      });
      continue;
    }

    if (abilityRoleId !== "librarian") {
      throw new Error("Only Librarian can preview no-characters information");
    }
    reminders.push({
      kind: "no_characters",
      abilityRoleId: "librarian",
      recipientPlayerId: recipient.playerId,
      noCharacterCategory: selected.noCharacterCategory,
    });
  }
  return reminders;
}

/**
 * Builds the truthful canonical Grimoire snapshot used by baseline_v1.
 *
 * This is intentionally narrower than ModeratorView: it contains character
 * tokens, life state, and currently modeled reminder-token facts only.
 * Recommendation metadata, reliability/truth labels, histories and moderator
 * controls never enter this snapshot.
 */
export function cloneTroubleBrewingSpyGrimoireSnapshot(
  snapshot: TroubleBrewingSpyGrimoireSnapshot,
): TroubleBrewingSpyGrimoireSnapshot {
  return {
    players: snapshot.players.map(player => ({ ...player })),
    reminders: {
      ...(snapshot.reminders.drunkPlayerId
        ? { drunkPlayerId: snapshot.reminders.drunkPlayerId }
        : {}),
      ...(snapshot.reminders.poisonedPlayerId
        ? { poisonedPlayerId: snapshot.reminders.poisonedPlayerId }
        : {}),
      ...(snapshot.reminders.butlerMasterPlayerId
        ? { butlerMasterPlayerId: snapshot.reminders.butlerMasterPlayerId }
        : {}),
      ...(snapshot.reminders.redHerringPlayerId
        ? { redHerringPlayerId: snapshot.reminders.redHerringPlayerId }
        : {}),
      pairInformation: snapshot.reminders.pairInformation.map(reminder =>
        reminder.kind === "pair"
          ? {
              ...reminder,
              shownPlayerIds: [...reminder.shownPlayerIds] as [string, string],
            }
          : { ...reminder },
      ),
    },
  };
}

export function createTroubleBrewingSpyGrimoireSnapshot(
  facts: TroubleBrewingSpyGrimoireFacts,
): TroubleBrewingSpyGrimoireSnapshot {
  const byPlayerId = new Map(
    facts.assignments.map(assignment => [assignment.playerId, assignment] as const),
  );
  if (
    facts.seatingPlayerIds.length !== facts.assignments.length ||
    new Set(facts.seatingPlayerIds).size !== facts.seatingPlayerIds.length
  ) {
    throw new Error("Spy Grimoire requires the complete unique seating order");
  }

  const dead = new Set(facts.deadPlayerIds);
  const players = facts.seatingPlayerIds.map(playerId => {
    const assignment = byPlayerId.get(playerId);
    if (!assignment) {
      throw new Error("Spy Grimoire seating references a non-player");
    }
    return {
      playerId,
      actualRoleId: assignment.actualRoleId,
      shownRoleId: assignment.shownRoleId,
      alive: !dead.has(playerId),
    };
  });

  const drunkPlayerId = facts.assignments.find(
    assignment => assignment.actualRoleId === "drunk",
  )?.playerId;

  return {
    players,
    reminders: {
      ...(drunkPlayerId ? { drunkPlayerId } : {}),
      ...(facts.poisonedPlayerId
        ? { poisonedPlayerId: facts.poisonedPlayerId }
        : {}),
      ...(facts.butlerMasterPlayerId
        ? { butlerMasterPlayerId: facts.butlerMasterPlayerId }
        : {}),
      ...(facts.redHerringPlayerId
        ? { redHerringPlayerId: facts.redHerringPlayerId }
        : {}),
      pairInformation: firstNightPairInformationReminders(facts),
    },
  };
}
