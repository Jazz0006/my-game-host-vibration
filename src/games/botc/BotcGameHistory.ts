import type { BotcCommand, BotcCommandOutcome, BotcGameState } from "./BotcGameModule.js";
import type { BotcNightInformationState } from "./BotcNightInformationRuntime.js";
import type { BotcDemonInfoView, BotcMinionInfoView } from "./BotcPlayerPrivateViews.js";

export type BotcRecordIdentity = Readonly<{ recordId: string; sequence: number }>;
export type BotcObservation = Readonly<Omit<BotcNightInformationState, "acknowledged"> & {
  recordId: string;
  /** null means imported committed information whose global order is unknown. */
  sequence: number | null;
}>;

const MECHANICAL_FIELDS = [
  "phase", "dayNumber", "nightNumber", "poisonedPlayerId", "butlerMasterPlayerId",
  "demonInfo", "redHerring", "deadPlayerIds", "assignments", "roleTransitions",
  "monkProtectedPlayerId", "winner", "day", "ghostVoteSpentPlayerIds",
] as const;
export type BotcMechanicalChanges = {
  [K in typeof MECHANICAL_FIELDS[number]]?: BotcGameState[K] | null;
};
export type BotcConfirmedAction = BotcRecordIdentity & (
  | { kind: "setup" }
  | {
      kind: "command";
      actorPlayerId?: string;
      authority: "player" | "moderator" | "automatic";
      at: number;
      command: BotcCommand;
      outcome: BotcCommandOutcome;
      effects: BotcMechanicalChanges;
    }
);
export type BotcGameHistory = {
  coverage: "from_creation" | "from_upgrade";
  nextSequence: number;
  actions: BotcConfirmedAction[];
  observations: BotcObservation[];
  notices: Array<BotcRecordIdentity & {
    stepId: string;
    nightNumber: number;
    recipientPlayerId: string;
    content: { kind: "minion_info"; value: BotcMinionInfoView } |
      { kind: "demon_info"; value: BotcDemonInfoView } |
      { kind: "role_change"; roleId: "imp" };
  }>;
  /** Delivery acknowledgement is progress, not a rewrite of committed content. */
  acknowledgedObservationIds: string[];
};

export function nextBotcRecord(state: Pick<BotcGameState, "gameId" | "history">): BotcRecordIdentity {
  const sequence = state.history.nextSequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("BotC history sequence exhausted or invalid");
  }
  state.history.nextSequence += 1;
  return { recordId: `${state.gameId}:fact:${sequence}`, sequence };
}

/** Records only accepted changes to concrete, currently implemented game facts. */
export function botcMechanicalChanges(before: BotcGameState, after: BotcGameState): BotcMechanicalChanges {
  const changes: Record<string, unknown> = {};
  for (const key of MECHANICAL_FIELDS) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = after[key] === undefined ? null : structuredClone(after[key]);
    }
  }
  return changes as BotcMechanicalChanges;
}
