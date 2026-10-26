import type {
  GameCommandContext,
  GameCommandResult,
  GameModule,
  GameModuleDependencies,
  GameViewContext,
} from "../../core/game/GameModule.js";
import {
  TROUBLE_BREWING_SCRIPT_ID,
  troubleBrewingRole,
  type BotcRoleCategory,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import {
  createTroubleBrewingFirstNightSequence,
  type BotcNightStep,
  type TroubleBrewingOtherNightFacts,
  type TroubleBrewingOtherNightRoleTransition,
} from "./TroubleBrewingNightSequence.js";
import {
  advanceTroubleBrewingOtherNightProgress,
  startTroubleBrewingOtherNightProgress,
  type TroubleBrewingOtherNightProgress,
} from "./TroubleBrewingNightProgression.js";
import {
  resolveTroubleBrewingNightChoice,
  troubleBrewingNightChoiceSpec,
  type TroubleBrewingNightChoiceSpec,
} from "./TroubleBrewingNightInteraction.js";
import {
  createTroubleBrewingRedHerringCandidates,
  type TroubleBrewingRedHerringSelectionSource,
} from "./TroubleBrewingFortuneTeller.js";
import {
  normalizeTroubleBrewingSetup,
  type BotcCanonicalSetupAssignment,
  type BotcSetupAssignment,
} from "./TroubleBrewingSetup.js";
import {
  createTroubleBrewingDemonInfoFacts,
  type TroubleBrewingDemonInfoFacts,
} from "./TroubleBrewingInformation.js";
import {
  createDemonBluffRecommendationRequest,
  createRedHerringRecommendationRequest,
  recommendDemonBluffsBaselineV1,
  recommendRedHerringBaselineV1,
  validateDemonBluffRecommendation,
} from "./TroubleBrewingRecommendation.js";
import {
  cloneNightInformationState,
  resolveCurrentNightInformation,
  currentFortuneTellerChoice,
  currentInformationState,
  informationReadyStep,
  moderatorInformationDecision,
  type BotcModeratorInformationDecisionView,
  type BotcNightInformationState,
} from "./BotcNightInformationRuntime.js";
import {
  createBotcDemonInfoView,
  createBotcMinionInfoView,
  createBotcPrivateInformationView,
  type BotcDemonInfoView,
  type BotcMinionInfoView,
  type BotcPrivateInformationView,
} from "./BotcPlayerPrivateViews.js";
import { botcMechanicalChanges, nextBotcRecord, type BotcGameHistory } from "./BotcGameHistory.js";
import { createTroubleBrewingDay, resolveTroubleBrewingDay, type BotcDayCommand, type BotcDayState } from "./TroubleBrewingDay.js";
import { resolveTroubleBrewingDeath, resolveTroubleBrewingImpAttack, troubleBrewingWinner, type BotcWinner } from "./TroubleBrewingLife.js";

export type { BotcSetupAssignment } from "./TroubleBrewingSetup.js";
export type {
  BotcDemonInfoView,
  BotcMinionInfoView,
  BotcPrivateInformationView,
} from "./BotcPlayerPrivateViews.js";
export type {
  BotcModeratorInformationDecisionView,
  BotcNightInformationSelectionSource,
  BotcNightInformationState,
} from "./BotcNightInformationRuntime.js";

export type BotcGameConfig = {
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
};

export type BotcCreateInput = {
  playerIds: readonly string[];
  config: BotcGameConfig;
  assignments: readonly BotcSetupAssignment[];
};

export type BotcGamePhase =
  | "role_reveal"
  | "first_night"
  | "day"
  | "other_night"
  | "finished";

export type BotcDemonInfoSelectionSource = "moderator" | "baseline_v1";

export type BotcDemonInfoState = {
  demonPlayerId: string;
  minionPlayerIds: string[];
  bluffRoleIds: TroubleBrewingRoleId[];
  selectionSource: BotcDemonInfoSelectionSource;
};

export const BOTC_GAME_STATE_SCHEMA_VERSION = 2;

export type BotcCommandContext = GameCommandContext & {
  /** Required by external command adapters; absent only for trusted game orchestration. */
  actionId?: string;
  automaticInformation?: boolean;
};

/** Accepted opening facts, never reconstructed from evolving assignments. */
export type BotcInitialSetup = Readonly<{
  config: Readonly<BotcGameConfig>;
  seatingPlayerIds: readonly string[];
  assignments: readonly Readonly<BotcCanonicalSetupAssignment>[];
}>;

export type BotcGameState = {
  readonly schemaVersion: typeof BOTC_GAME_STATE_SCHEMA_VERSION;
  readonly gameId: string;
  readonly initialSetup: BotcInitialSetup;
  interactionId: string;
  history: BotcGameHistory;
  day?: BotcDayState;
  ghostVoteSpentPlayerIds: string[];
  winner?: BotcWinner;
  monkProtectedPlayerId?: string;
  ravenkeeperChoice?: { nightNumber: number; playerId: string };
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
  phase: BotcGamePhase;
  seatingPlayerIds: string[];
  assignments: BotcCanonicalSetupAssignment[];
  confirmedRolePlayerIds: string[];
  dayNumber: number;
  nightNumber: number;
  deadPlayerIds: string[];
  diedTonightPlayerIds: string[];
  executedAndDiedTodayPlayerId?: string;
  roleTransitions: TroubleBrewingOtherNightRoleTransition[];
  demonInfo?: BotcDemonInfoState;
  redHerring?: {
    playerId: string;
    selectionSource: TroubleBrewingRedHerringSelectionSource;
  };
  fortuneTellerChoice?: {
    nightNumber: number;
    playerIds: [string, string];
  };
  poisonedPlayerId?: string;
  butlerMasterPlayerId?: string;
  nightStepIndex?: number;
  otherNightProgress?: TroubleBrewingOtherNightProgress;
};

export type BotcCommand =
  | BotcDayCommand
  | { type: "confirmRole" }
  | { type: "setDemonBluffs"; roleIds: TroubleBrewingRoleId[] }
  | { type: "setRedHerring"; playerId: string }
  | { type: "beginFirstNight" }
  | { type: "beginOtherNight" }
  | { type: "submitNightChoice"; playerIds: string[] }
  | { type: "commitNightInformation" }
  | { type: "acknowledgeNightInformation" }
  | { type: "completeNightStep" };

export type BotcCommandOutcome =
  | { kind: "dayActionCommitted"; action: BotcDayCommand["type"]; executionPlayerId?: string; executionDied?: boolean; voteCount?: number }
  | {
      kind: "roleConfirmed";
      allConfirmed: boolean;
    }
  | {
      kind: "demonBluffsCommitted";
      source: BotcDemonInfoSelectionSource;
      roleIds: TroubleBrewingRoleId[];
    }
  | {
      kind: "redHerringCommitted";
      playerId: string;
      source: TroubleBrewingRedHerringSelectionSource;
    }
  | {
      kind: "firstNightStarted";
      firstStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "otherNightStarted";
      firstStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "nightChoiceCommitted";
      completedStepId: BotcNightStep["id"];
      selectedPlayerIds: string[];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "nightChoiceRecorded";
      stepId: BotcNightStep["id"];
      selectedPlayerIds: string[];
    }
  | {
      kind: "nightInformationCommitted";
      stepId: BotcNightStep["id"];
      recipientPlayerId: string;
      candidateId: string;
      selectionSource: BotcNightInformationState["selectionSource"];
    }
  | {
      kind: "nightInformationAcknowledged";
      completedStepId: BotcNightStep["id"];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "nightStepCompleted";
      completedStepId: BotcNightStep["id"];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    };

export type BotcPlayerNightStepView = {
  id: BotcNightStep["id"];
  kind: BotcNightStep["kind"];
  roleId?: TroubleBrewingRoleId;
  choice?: TroubleBrewingNightChoiceSpec;
};

export type BotcRedHerringDecisionView = {
  candidatePlayerIds: string[];
  selectedPlayerId?: string;
};

export type BotcPlayerView = {
  actionId?: string;
  phase: BotcGamePhase;
  mode: "role_reveal" | "waiting" | "night_wake" | "day" | "spectator";
  roleId?: TroubleBrewingRoleId;
  roleName?: string;
  roleNameZh?: string;
  roleCategory?: BotcRoleCategory;
  roleConfirmed?: boolean;
  nightStep?: BotcPlayerNightStepView;
  minionInfo?: BotcMinionInfoView;
  demonInfo?: BotcDemonInfoView;
  privateInformation?: BotcPrivateInformationView;
  alive?: boolean;
  canNominate?: boolean;
  nominationTargetIds?: string[];
  canVote?: boolean;
  voteSubmitted?: boolean;
};

export type BotcPublicView = {
  canCompleteNightStep: boolean;
  actionId: string;
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
  phase: BotcGamePhase;
  playerCount: number;
  confirmedRoles: number;
  dayNumber: number;
  nightNumber: number;
  deadPlayerIds: string[];
  ghostVoteSpentPlayerIds: string[];
  winner?: BotcWinner;
  day?: Omit<BotcDayState, "ballot"> & { ballot?: { nominatorPlayerId: string; nomineePlayerId: string; submittedCount: number } };
};

export type BotcModeratorView = BotcPublicView & {
  assignments: BotcCanonicalSetupAssignment[];
  nightStep?: BotcNightStep;
  nightEffects?: {
    poisonedPlayerId?: string;
    butlerMasterPlayerId?: string;
  };
  demonInfo?: BotcDemonInfoView;
  redHerring?: {
    playerId: string;
    selectionSource: TroubleBrewingRedHerringSelectionSource;
  };
  redHerringDecision?: BotcRedHerringDecisionView;
  informationDecision?: BotcModeratorInformationDecisionView;
  currentInformation?: BotcNightInformationState;
};

function firstNightSequence(state: BotcGameState): BotcNightStep[] {
  return createTroubleBrewingFirstNightSequence(state.assignments);
}

function demonInfoFacts(state: BotcGameState): TroubleBrewingDemonInfoFacts {
  return createTroubleBrewingDemonInfoFacts(state.assignments);
}

function demonBluffRecommendationRequest(
  state: BotcGameState,
  facts: TroubleBrewingDemonInfoFacts,
) {
  const drunk = state.assignments.find(
    assignment => assignment.actualRoleId === "drunk",
  );
  return createDemonBluffRecommendationRequest(
    facts,
    drunk ? { shownDrunkRoleId: drunk.shownRoleId } : undefined,
  );
}

function commitDemonBluffs(
  state: BotcGameState,
  roleIds: TroubleBrewingRoleId[],
  selectionSource: BotcDemonInfoSelectionSource,
): BotcDemonInfoState {
  const facts = demonInfoFacts(state);
  const request = demonBluffRecommendationRequest(state, facts);
  const recommendation = validateDemonBluffRecommendation(request, { roleIds });

  const committed: BotcDemonInfoState = {
    demonPlayerId: facts.demonPlayerId,
    minionPlayerIds: [...facts.minionPlayerIds],
    bluffRoleIds: [...recommendation.roleIds],
    selectionSource,
  };
  state.demonInfo = committed;
  return committed;
}

function ensureAutomaticDemonBluffs(
  state: BotcGameState,
  dependencies: GameModuleDependencies,
): void {
  if (state.assignments.length < 7 || state.demonInfo) return;

  const facts = demonInfoFacts(state);
  const request = demonBluffRecommendationRequest(state, facts);
  const recommendation = recommendDemonBluffsBaselineV1(
    request,
    dependencies.random,
  );
  commitDemonBluffs(state, recommendation.roleIds, "baseline_v1");
}

function commitRedHerring(
  state: BotcGameState,
  playerId: string,
  selectionSource: TroubleBrewingRedHerringSelectionSource,
): NonNullable<BotcGameState["redHerring"]> {
  if (!createTroubleBrewingRedHerringCandidates(state.assignments).includes(playerId)) {
    throw new Error("Fortune Teller Red Herring must be an actual good player");
  }
  const committed = { playerId, selectionSource };
  state.redHerring = committed;
  return committed;
}

function ensureAutomaticRedHerring(
  state: BotcGameState,
): void {
  if (state.redHerring) return;
  const hasFortuneTellerStep = state.assignments.some(
    assignment =>
      assignment.actualRoleId === "fortune_teller" ||
      (assignment.actualRoleId === "drunk" && assignment.shownRoleId === "fortune_teller"),
  );
  if (!hasFortuneTellerStep) return;
  const request = createRedHerringRecommendationRequest(
    createTroubleBrewingRedHerringCandidates(state.assignments),
  );
  const recommendation = recommendRedHerringBaselineV1(request);
  commitRedHerring(state, recommendation.playerId, "baseline_v1");
}

function redHerringDecision(
  state: BotcGameState,
): BotcRedHerringDecisionView | undefined {
  if (state.phase !== "role_reveal") return undefined;
  const hasFortuneTellerStep = state.assignments.some(
    assignment =>
      assignment.actualRoleId === "fortune_teller" ||
      (assignment.actualRoleId === "drunk" && assignment.shownRoleId === "fortune_teller"),
  );
  if (!hasFortuneTellerStep) return undefined;
  return {
    candidatePlayerIds: createTroubleBrewingRedHerringCandidates(state.assignments),
    ...(state.redHerring ? { selectedPlayerId: state.redHerring.playerId } : {}),
  };
}

function otherNightFacts(state: BotcGameState): TroubleBrewingOtherNightFacts {
  return {
    assignments: state.assignments,
    deadPlayerIds: state.deadPlayerIds,
    diedTonightPlayerIds: state.diedTonightPlayerIds,
    ...(state.executedAndDiedTodayPlayerId
      ? { executedAndDiedTodayPlayerId: state.executedAndDiedTodayPlayerId }
      : {}),
    roleTransitions: state.roleTransitions,
  };
}

function currentNightStep(state: BotcGameState): BotcNightStep | undefined {
  if (state.phase === "first_night") {
    if (state.nightStepIndex === undefined) return undefined;
    return firstNightSequence(state)[state.nightStepIndex];
  }

  if (state.phase === "other_night") {
    return state.otherNightProgress?.activeStep;
  }

  return undefined;
}

function playerNightStepView(
  step: BotcNightStep,
  playerId: string,
  participantPlayerIds: readonly string[],
  suppressChoice = false,
): BotcPlayerNightStepView {
  if (step.kind === "system_info") {
    return {
      id: step.id,
      kind: step.kind,
    };
  }

  const choice = suppressChoice
    ? undefined
    : troubleBrewingNightChoiceSpec(
        step,
        playerId,
        participantPlayerIds,
      );
  return {
    id: step.id,
    kind: step.kind,
    roleId: step.roleId,
    ...(choice ? { choice } : {}),
  };
}

function commitResolvedRoleTransitions(state: BotcGameState): void {
  for (const transition of state.roleTransitions) {
    const newImpPlayerId =
      transition.kind === "scarlet_woman_to_imp"
        ? transition.playerId
        : transition.newImpPlayerId;
    const assignment = state.assignments.find(
      item => item.playerId === newImpPlayerId,
    );
    if (!assignment) {
      throw new Error("BotC role transition references a non-player");
    }
    assignment.actualRoleId = "imp";
    assignment.shownRoleId = "imp";
  }
}

function clearCompletedOtherNightFacts(state: BotcGameState): void {
  state.diedTonightPlayerIds = [];
  state.roleTransitions = [];
  delete state.executedAndDiedTodayPlayerId;
  delete state.otherNightProgress;
  delete state.monkProtectedPlayerId;
  delete state.ravenkeeperChoice;
}

function enterDay(state: BotcGameState): void {
  state.phase = "day";
  state.day = createTroubleBrewingDay();
  const winner = troubleBrewingWinner(state);
  if (winner) { state.winner = winner; state.phase = "finished"; }
}

function advanceCurrentNightStep(
  state: BotcGameState,
): Extract<BotcCommandOutcome, { kind: "nightStepCompleted" }> {
  if (state.phase === "first_night") {
    const step = currentNightStep(state);
    if (!step || state.nightStepIndex === undefined) {
      throw new Error("There is no active BotC night step");
    }

    const sequence = firstNightSequence(state);
    const nextStep = sequence[state.nightStepIndex + 1];
    if (!nextStep) {
      state.phase = "day";
      state.dayNumber = 1;
      enterDay(state);
      delete state.nightStepIndex;
      return {
        kind: "nightStepCompleted",
        completedStepId: step.id,
        nightComplete: true,
      };
    }

    state.nightStepIndex += 1;
    return {
      kind: "nightStepCompleted",
      completedStepId: step.id,
      nextStepId: nextStep.id,
      nightComplete: false,
    };
  }

  if (state.phase === "other_night" && state.otherNightProgress?.activeStep) {
    const advanced = advanceTroubleBrewingOtherNightProgress(
      otherNightFacts(state),
      state.otherNightProgress,
    );
    state.otherNightProgress = advanced.progress;

    if (!advanced.nextStep) {
      state.phase = "day";
      state.dayNumber += 1;
      commitResolvedRoleTransitions(state);
      clearCompletedOtherNightFacts(state);
      enterDay(state);
      return {
        kind: "nightStepCompleted",
        completedStepId: advanced.completedStep.id,
        nightComplete: true,
      };
    }

    return {
      kind: "nightStepCompleted",
      completedStepId: advanced.completedStep.id,
      nextStepId: advanced.nextStep.id,
      nightComplete: false,
    };
  }

  throw new Error("There is no active BotC night step");
}

function publicView(state: BotcGameState): BotcPublicView {
  const day = state.day;
  const { ballot, ...dayFacts } = day ?? createTroubleBrewingDay();
  const step = currentNightStep(state);
  const actor = step?.actorPlayerIds[0];
  return {
    canCompleteNightStep: Boolean(step && !informationReadyStep(state, step) &&
      !(actor && troubleBrewingNightChoiceSpec(step, actor, state.seatingPlayerIds))),
    actionId: state.interactionId,
    scriptId: state.scriptId,
    phase: state.phase,
    playerCount: state.assignments.length,
    confirmedRoles: state.confirmedRolePlayerIds.length,
    dayNumber: state.dayNumber,
    nightNumber: state.nightNumber,
    deadPlayerIds: state.deadPlayerIds.filter(id => !state.diedTonightPlayerIds.includes(id)),
    ghostVoteSpentPlayerIds: [...state.ghostVoteSpentPlayerIds],
    ...(state.winner ? { winner: { ...state.winner } } : {}),
    ...(state.phase === "day" || state.phase === "finished" ? { day: {
      ...structuredClone(dayFacts), ...(ballot ? { ballot: { nominatorPlayerId: ballot.nominatorPlayerId,
        nomineePlayerId: ballot.nomineePlayerId, submittedCount: Object.keys(ballot.votes).length } } : {}),
    } } : {}),
  };
}

export class BotcGameModule implements GameModule<
  BotcGameState,
  BotcCommand,
  BotcPlayerView,
  BotcModeratorView,
  BotcPublicView,
  BotcCreateInput,
  BotcCommandOutcome
> {
  readonly type = "botc";

  createGame(input: BotcCreateInput, dependencies: GameModuleDependencies): BotcGameState {
    if (input.config.scriptId !== TROUBLE_BREWING_SCRIPT_ID) {
      throw new Error("Only Trouble Brewing is supported in B0");
    }

    const assignments = normalizeTroubleBrewingSetup(input.playerIds, input.assignments);
    const gameId = dependencies.random.randomId();
    if (!gameId.trim()) throw new Error("BotC gameId cannot be blank");

    return {
      schemaVersion: BOTC_GAME_STATE_SCHEMA_VERSION,
      gameId,
      interactionId: dependencies.random.randomId(),
      ghostVoteSpentPlayerIds: [],
      history: {
        coverage: "from_creation",
        nextSequence: 2,
        actions: [{ kind: "setup", recordId: `${gameId}:fact:1`, sequence: 1 }],
        observations: [],
        notices: [],
        acknowledgedObservationIds: [],
      },
      initialSetup: {
        config: { ...input.config },
        seatingPlayerIds: [...input.playerIds],
        assignments: assignments.map(assignment => ({ ...assignment })),
      },
      scriptId: TROUBLE_BREWING_SCRIPT_ID,
      phase: "role_reveal",
      seatingPlayerIds: [...input.playerIds],
      assignments,
      confirmedRolePlayerIds: [],
      dayNumber: 0,
      nightNumber: 0,
      deadPlayerIds: [],
      diedTonightPlayerIds: [],
      roleTransitions: [],
    };
  }

  handleCommand(
    state: BotcGameState,
    context: BotcCommandContext,
    command: BotcCommand,
    dependencies: GameModuleDependencies,
  ): GameCommandResult<BotcGameState, BotcCommandOutcome> {
    if (context.actionId !== undefined && context.actionId !== state.interactionId) {
      throw new Error("Stale BotC interaction; synchronize before acting");
    }
    const draft = structuredClone(state);
    const promptBefore = this.interactionKey(state);
    if (command.type === "beginOtherNight" && state.phase === "day" &&
      !draft.day?.closed && !draft.day?.ballot && !draft.day?.nominators.length) {
      this.acceptCommand(draft, context, { type: "closeDay" }, dependencies);
    }
    const outcome = this.acceptCommand(draft, context, command, dependencies);
    if (context.automaticInformation) {
      const decision = moderatorInformationDecision(draft, currentNightStep(draft));
      if (decision && !decision.committed) {
        this.acceptCommand(draft, { isModerator: true, now: context.now },
          { type: "commitNightInformation" }, dependencies, true);
      }
    }
    this.commitCurrentNotices(draft);
    if (promptBefore !== this.interactionKey(draft)) {
      draft.interactionId = dependencies.random.randomId();
    }
    for (const key of Object.keys(state)) {
      if (!(key in draft)) delete (state as unknown as Record<string, unknown>)[key];
    }
    Object.assign(state, draft);
    return { state, outcome };
  }

  private interactionKey(state: BotcGameState): string {
    const step = currentNightStep(state);
    return JSON.stringify([state.phase, state.dayNumber, state.nightNumber, step?.id,
      currentFortuneTellerChoice(state), state.ravenkeeperChoice, currentInformationState(state, step),
      state.day?.nominators.length, Boolean(state.day?.ballot), state.day?.closed]);
  }

  private commitCurrentNotices(state: BotcGameState): void {
    const step = currentNightStep(state);
    if (!step || (step.kind !== "system_info" && step.kind !== "role_change_info")) return;
    for (const recipientPlayerId of step.actorPlayerIds) {
      if (state.history.notices.some(item => item.stepId === step.id &&
        item.nightNumber === state.nightNumber && item.recipientPlayerId === recipientPlayerId)) continue;
      const minion = step.id === "minion_info" ? createBotcMinionInfoView(demonInfoFacts(state), recipientPlayerId) : undefined;
      const demon = step.id === "demon_info" ? createBotcDemonInfoView(state.demonInfo) : undefined;
      const content = minion ? { kind: "minion_info" as const, value: minion } :
        demon ? { kind: "demon_info" as const, value: demon } :
        step.kind === "role_change_info" ? { kind: "role_change" as const, roleId: "imp" as const } : undefined;
      if (content) state.history.notices.push({ ...nextBotcRecord(state), stepId: step.id,
        nightNumber: state.nightNumber, recipientPlayerId, content: structuredClone(content) });
    }
  }

  private acceptCommand(
    state: BotcGameState,
    context: GameCommandContext,
    command: BotcCommand,
    dependencies: GameModuleDependencies,
    automatic = false,
  ): BotcCommandOutcome {
    const before = structuredClone(state);
    const identity = nextBotcRecord(state);
    const result = this.applyCommand(state, context, command, dependencies);
    if (!result.outcome) throw new Error("BotC command produced no outcome");
    state.history.actions.push({
      ...identity, kind: "command", at: context.now,
      ...(context.playerId ? { actorPlayerId: context.playerId } : {}),
      authority: automatic ? "automatic" : context.isModerator ? "moderator" : "player",
      command: structuredClone(command), outcome: structuredClone(result.outcome),
      effects: botcMechanicalChanges(before, state),
    });
    return result.outcome;
  }

  private applyCommand(
    state: BotcGameState,
    context: GameCommandContext,
    command: BotcCommand,
    dependencies: GameModuleDependencies,
  ): GameCommandResult<BotcGameState, BotcCommandOutcome> {
    switch (command.type) {
      case "nominate":
      case "vote":
      case "finishVote":
      case "closeDay": {
        const resolved = resolveTroubleBrewingDay(state, context.playerId, context.isModerator, command);
        state.day = resolved.day;
        state.ghostVoteSpentPlayerIds = resolved.ghostVoteSpentPlayerIds;
        if (command.type === "closeDay") {
          const target = resolved.day.executionPlayerId;
          if (target) {
            const victim = state.assignments.find(item => item.playerId === target)!;
            const death = resolveTroubleBrewingDeath(state, target, "execution");
            state.deadPlayerIds = death.deadPlayerIds;
            state.assignments = death.assignments;
            state.roleTransitions = death.roleTransitions;
            state.day.executionDied = death.died;
            if (death.died) state.executedAndDiedTodayPlayerId = target;
            if (death.died && victim.actualRoleId === "saint" && state.poisonedPlayerId !== target) {
              state.winner = { team: "evil", reason: "saint_executed" };
            }
          }
          const winner = state.winner ?? troubleBrewingWinner(state);
          if (winner) state.winner = winner;
          if (state.winner) state.phase = "finished";
        }
        return { state, outcome: { kind: "dayActionCommitted", action: command.type,
          ...(state.day.executionPlayerId ? { executionPlayerId: state.day.executionPlayerId } : {}),
          ...(state.day.executionDied === undefined ? {} : { executionDied: state.day.executionDied }),
          ...(command.type === "finishVote" ? { voteCount: state.day.tallies.at(-1)!.voteCount } : {}),
        } };
      }
      case "confirmRole": {
        if (state.phase !== "role_reveal") {
          throw new Error("BotC role confirmation is closed");
        }
        if (!context.playerId) throw new Error("player command requires playerId");
        if (!state.assignments.some(assignment => assignment.playerId === context.playerId)) {
          throw new Error("Only a seated BotC player can confirm a role");
        }
        if (!state.confirmedRolePlayerIds.includes(context.playerId)) {
          state.confirmedRolePlayerIds.push(context.playerId);
        }
        return {
          state,
          outcome: {
            kind: "roleConfirmed",
            allConfirmed:
              state.confirmedRolePlayerIds.length === state.assignments.length,
          },
        };
      }

      case "setDemonBluffs": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can set Demon bluffs");
        }
        if (state.phase !== "role_reveal") {
          throw new Error("Demon bluffs can only be set before the first night");
        }

        const committed = commitDemonBluffs(
          state,
          command.roleIds,
          "moderator",
        );
        return {
          state,
          outcome: {
            kind: "demonBluffsCommitted",
            source: committed.selectionSource,
            roleIds: [...committed.bluffRoleIds],
          },
        };
      }

      case "setRedHerring": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can set the Fortune Teller Red Herring");
        }
        if (state.phase !== "role_reveal") {
          throw new Error("Fortune Teller Red Herring can only be set before the first night");
        }
        const committed = commitRedHerring(state, command.playerId, "moderator");
        return {
          state,
          outcome: {
            kind: "redHerringCommitted",
            playerId: committed.playerId,
            source: committed.selectionSource,
          },
        };
      }

      case "beginFirstNight": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can begin the first night");
        }
        if (state.phase !== "role_reveal") {
          throw new Error("BotC first night can only begin after role reveal");
        }
        if (state.confirmedRolePlayerIds.length !== state.assignments.length) {
          throw new Error("All BotC players must confirm their shown role first");
        }

        ensureAutomaticDemonBluffs(state, dependencies);
        ensureAutomaticRedHerring(state);

        const sequence = firstNightSequence(state);
        const firstStep = sequence[0];
        state.nightNumber = 1;
        if (!firstStep) {
          state.phase = "day";
          state.dayNumber = 1;
          enterDay(state);
          delete state.nightStepIndex;
          return {
            state,
            outcome: {
              kind: "firstNightStarted",
              nightComplete: true,
            },
          };
        }

        state.phase = "first_night";
        state.nightStepIndex = 0;
        return {
          state,
          outcome: {
            kind: "firstNightStarted",
            firstStepId: firstStep.id,
            nightComplete: false,
          },
        };
      }

      case "beginOtherNight": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can begin another night");
        }
        if (state.phase !== "day") {
          throw new Error("BotC other night can only begin from day");
        }
        if (!state.day?.closed) throw new Error("Close the day before beginning the next night");

        // Night-start is dusk for these day-spanning effects. The previous
        // Poisoner target becomes healthy and the previous Butler master stops
        // constraining tomorrow's vote before the new nightly choices occur.
        delete state.poisonedPlayerId;
        delete state.butlerMasterPlayerId;
        delete state.fortuneTellerChoice;
        delete state.ravenkeeperChoice;
        delete state.monkProtectedPlayerId;
        state.diedTonightPlayerIds = [];
        const progress = startTroubleBrewingOtherNightProgress(otherNightFacts(state));
        state.nightNumber += 1;

        if (!progress.activeStep) {
          state.dayNumber += 1;
          clearCompletedOtherNightFacts(state);
          enterDay(state);
          return {
            state,
            outcome: {
              kind: "otherNightStarted",
              nightComplete: true,
            },
          };
        }

        state.phase = "other_night";
        state.otherNightProgress = progress;
        return {
          state,
          outcome: {
            kind: "otherNightStarted",
            firstStepId: progress.activeStep.id,
            nightComplete: false,
          },
        };
      }

      case "submitNightChoice": {
        if (!context.playerId) {
          throw new Error("player command requires playerId");
        }

        const step = currentNightStep(state);
        if (!step || !step.actorPlayerIds.includes(context.playerId)) {
          throw new Error("Only the active BotC night actor can submit this choice");
        }

        const participantPlayerIds = state.assignments.map(
          assignment => assignment.playerId,
        );
        const resolution = resolveTroubleBrewingNightChoice(
          step,
          context.playerId,
          participantPlayerIds,
          command.playerIds,
        );

        if (resolution.kind === "fortune_teller_targets") {
          if (currentFortuneTellerChoice(state)) {
            throw new Error("Fortune Teller targets are already recorded for this night");
          }
          state.fortuneTellerChoice = {
            nightNumber: state.nightNumber,
            playerIds: [...resolution.targetPlayerIds] as [string, string],
          };
          return {
            state,
            outcome: {
              kind: "nightChoiceRecorded",
              stepId: step.id,
              selectedPlayerIds: [...resolution.targetPlayerIds] as [string, string],
            },
          };
        }

        if (resolution.kind === "ravenkeeper_target") {
          if (state.ravenkeeperChoice?.nightNumber === state.nightNumber) throw new Error("Ravenkeeper target is already recorded");
          state.ravenkeeperChoice = { nightNumber: state.nightNumber, playerId: resolution.targetPlayerId };
          return { state, outcome: { kind: "nightChoiceRecorded", stepId: step.id, selectedPlayerIds: [resolution.targetPlayerId] } };
        }

        if (resolution.appliesEffect && state.poisonedPlayerId !== context.playerId) {
          if (resolution.kind === "poisoner_target") {
            state.poisonedPlayerId = resolution.targetPlayerId;
          } else if (resolution.kind === "butler_master") {
            state.butlerMasterPlayerId = resolution.targetPlayerId;
          } else if (resolution.kind === "monk_protection") {
            state.monkProtectedPlayerId = resolution.targetPlayerId;
          } else if (resolution.kind === "imp_attack") {
            const death = resolveTroubleBrewingImpAttack(state, context.playerId, resolution.targetPlayerId);
            if (death?.died) {
              state.deadPlayerIds = death.deadPlayerIds;
              state.assignments = death.assignments;
              state.roleTransitions = death.roleTransitions;
              state.diedTonightPlayerIds.push(resolution.targetPlayerId);
            }
          }
        }

        const advanced = advanceCurrentNightStep(state);
        return {
          state,
          outcome: {
            kind: "nightChoiceCommitted",
            completedStepId: advanced.completedStepId,
            selectedPlayerIds: [resolution.targetPlayerId],
            ...(advanced.nextStepId
              ? { nextStepId: advanced.nextStepId }
              : {}),
            nightComplete: advanced.nightComplete,
          },
        };
      }

      case "commitNightInformation": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can commit night information");
        }
        const committed = resolveCurrentNightInformation(
          state,
          currentNightStep(state),
        );
        const { acknowledged, ...content } = committed;
        state.history.observations.push({ ...nextBotcRecord(state), ...content });
        return {
          state,
          outcome: {
            kind: "nightInformationCommitted",
            stepId: committed.stepId,
            recipientPlayerId: committed.recipientPlayerId,
            candidateId: committed.result.selectedCandidateId,
            selectionSource: committed.selectionSource,
          },
        };
      }

      case "acknowledgeNightInformation": {
        if (!context.playerId) {
          throw new Error("player command requires playerId");
        }
        const step = currentNightStep(state);
        const activeInformationStep = informationReadyStep(state, step);
        if (
          !activeInformationStep ||
          !activeInformationStep.actorPlayerIds.includes(context.playerId)
        ) {
          throw new Error(
            "Only the active BotC information recipient can acknowledge this information",
          );
        }
        const information = currentInformationState(state, activeInformationStep);
        if (!information || information.acknowledged) {
          throw new Error("Active BotC night information is not ready for acknowledgement");
        }
        const record = state.history.observations.find(item =>
          item.nightNumber === information.nightNumber && item.stepId === information.stepId &&
          item.recipientPlayerId === information.recipientPlayerId);
        if (!record) throw new Error("Committed information record is missing");
        state.history.acknowledgedObservationIds.push(record.recordId);
        const wasFortuneTeller = activeInformationStep.roleId === "fortune_teller";
        const advanced = advanceCurrentNightStep(state);
        if (wasFortuneTeller) {
          delete state.fortuneTellerChoice;
        }
        return {
          state,
          outcome: {
            kind: "nightInformationAcknowledged",
            completedStepId: advanced.completedStepId,
            ...(advanced.nextStepId
              ? { nextStepId: advanced.nextStepId }
              : {}),
            nightComplete: advanced.nightComplete,
          },
        };
      }

      case "completeNightStep": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can complete a night step");
        }

        const step = currentNightStep(state);
        if (!step) {
          throw new Error("There is no active BotC night step");
        }
        if (informationReadyStep(state, step)) {
          const information = currentInformationState(state, step);
          throw new Error(
            information
              ? "Active BotC information step requires player acknowledgement"
              : "Active BotC information step requires an authoritative information commit",
          );
        }
        const actorPlayerId = step.actorPlayerIds[0];
        if (
          actorPlayerId &&
          troubleBrewingNightChoiceSpec(
            step,
            actorPlayerId,
            state.assignments.map(assignment => assignment.playerId),
          )
        ) {
          throw new Error("Active BotC night step requires a player choice");
        }

        return {
          state,
          outcome: advanceCurrentNightStep(state),
        };
      }
    }
  }

  getPlayerView(
    state: BotcGameState,
    playerId: string,
    context: GameViewContext,
  ): BotcPlayerView {
    const assignment = state.assignments.find(item => item.playerId === playerId);
    if (!assignment) return { phase: state.phase, mode: "spectator", actionId: state.interactionId };

    const activeStep = currentNightStep(state);
    const visibleRoleId =
      activeStep?.actorPlayerIds.includes(playerId) &&
      activeStep.kind !== "system_info" &&
      (activeStep.kind === "role_change_info" ||
        activeStep.actorSource === "role_transition")
        ? activeStep.roleId
        : assignment.shownRoleId;
    const visibleRole = troubleBrewingRole(visibleRoleId);
    const confirmed = state.confirmedRolePlayerIds.includes(playerId);
    const base = {
      actionId: state.interactionId,
      phase: state.phase,
      alive: !publicView(state).deadPlayerIds.includes(playerId),
      roleId: visibleRole.id,
      roleName: visibleRole.name,
      roleNameZh: visibleRole.nameZh,
      roleCategory: visibleRole.category,
      roleConfirmed: confirmed,
      ...(state.phase === "day" ? {
        canNominate: !state.deadPlayerIds.includes(playerId) && !state.day?.closed &&
          !state.day?.ballot && !state.day?.nominators.includes(playerId),
        nominationTargetIds: state.seatingPlayerIds.filter(id => !state.day?.nominees.includes(id)),
        canVote: Boolean(state.day?.ballot) &&
          (!state.deadPlayerIds.includes(playerId) || !state.ghostVoteSpentPlayerIds.includes(playerId)) &&
          !(playerId in (state.day?.ballot?.votes ?? {})),
        voteSubmitted: playerId in (state.day?.ballot?.votes ?? {}),
      } : {}),
    };

    if (state.phase === "role_reveal") {
      return {
        ...base,
        mode: confirmed ? "waiting" : "role_reveal",
      };
    }

    if (state.phase === "first_night" || state.phase === "other_night") {
      const step = currentNightStep(state);
      if (step?.actorPlayerIds.includes(playerId)) {
        const notice = state.history.notices.find(item => item.stepId === step.id &&
          item.nightNumber === state.nightNumber && item.recipientPlayerId === playerId)?.content;
        const activeMinionInfo =
          notice?.kind === "minion_info" ? structuredClone(notice.value) : step.id === "minion_info"
            ? createBotcMinionInfoView(demonInfoFacts(state), playerId)
            : undefined;
        const activeDemonInfo =
          notice?.kind === "demon_info" ? structuredClone(notice.value) : step.id === "demon_info" &&
          state.demonInfo?.demonPlayerId === playerId
            ? createBotcDemonInfoView(state.demonInfo)
            : undefined;
        const activeInformation = currentInformationState(state, step);
        const privateInformation =
          activeInformation &&
          !activeInformation.acknowledged &&
          activeInformation.recipientPlayerId === playerId
            ? createBotcPrivateInformationView(activeInformation.result, context)
            : undefined;
        return {
          ...base,
          mode: "night_wake",
          nightStep: playerNightStepView(
            step,
            playerId,
            state.assignments.map(assignment => assignment.playerId),
            step.kind === "role" &&
              ((step.roleId === "fortune_teller" && Boolean(currentFortuneTellerChoice(state))) ||
                (step.roleId === "ravenkeeper" && state.ravenkeeperChoice?.nightNumber === state.nightNumber)),
          ),
          ...(activeMinionInfo ? { minionInfo: activeMinionInfo } : {}),
          ...(activeDemonInfo ? { demonInfo: activeDemonInfo } : {}),
          ...(privateInformation ? { privateInformation } : {}),
        };
      }
      return {
        ...base,
        mode: "waiting",
      };
    }

    return {
      ...base,
      mode: "day",
    };
  }

  getModeratorView(
    state: BotcGameState,
    _context: GameViewContext,
  ): BotcModeratorView {
    const step = currentNightStep(state);
    const privateDemonInfo = createBotcDemonInfoView(state.demonInfo);
    const informationDecision = moderatorInformationDecision(state, step);
    const currentInformation = currentInformationState(state, step);
    const activeRedHerringDecision = redHerringDecision(state);
    const nightEffects =
      state.poisonedPlayerId || state.butlerMasterPlayerId
        ? {
            ...(state.poisonedPlayerId
              ? { poisonedPlayerId: state.poisonedPlayerId }
              : {}),
            ...(state.butlerMasterPlayerId
              ? { butlerMasterPlayerId: state.butlerMasterPlayerId }
              : {}),
          }
        : undefined;
    return {
      ...publicView(state),
      assignments: state.assignments.map(assignment => ({ ...assignment })),
      ...(nightEffects ? { nightEffects } : {}),
      ...(step
        ? {
            nightStep: {
              ...step,
              actorPlayerIds: [...step.actorPlayerIds],
            },
          }
        : {}),
      ...(privateDemonInfo ? { demonInfo: privateDemonInfo } : {}),
      ...(state.redHerring
        ? { redHerring: { ...state.redHerring } }
        : {}),
      ...(activeRedHerringDecision
        ? { redHerringDecision: activeRedHerringDecision }
        : {}),
      ...(informationDecision ? { informationDecision } : {}),
      ...(currentInformation
        ? { currentInformation: cloneNightInformationState(currentInformation) }
        : {}),
    };
  }

  getPublicView(
    state: BotcGameState,
    _context: GameViewContext,
  ): BotcPublicView {
    return publicView(state);
  }
}

export const botcGameModule = new BotcGameModule();

/** Command receipts are private runtime facts, not an alternate secret view. */
export function botcClientOutcome(outcome: BotcCommandOutcome | { kind: "gameStarted" }, moderatorSecrets: boolean): unknown {
  if (moderatorSecrets || outcome.kind === "dayActionCommitted" || outcome.kind === "roleConfirmed") {
    return structuredClone(outcome);
  }
  return { kind: outcome.kind, ...("nightComplete" in outcome ? { nightComplete: outcome.nightComplete } : {}) };
}

