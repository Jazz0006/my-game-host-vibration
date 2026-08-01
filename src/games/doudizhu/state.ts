import type { BiddingState, Bid } from "./bidding.js";
import type { CardId } from "./cards.js";
import type { Combination } from "./combinations.js";
import type { ScoreResult } from "./scoring.js";

export const DOUDIZHU_RULES_VERSION = "doudizhu-classic-v1" as const;

export type DouDizhuPhase = "bidding" | "playing" | "game_over";

export type PlayedCombination = {
  playerId: string;
  cardIds: CardId[];
  combination: Combination;
};

export type DouDizhuGameState = {
  rulesVersion: typeof DOUDIZHU_RULES_VERSION;
  phase: DouDizhuPhase;
  revision: number;
  actionId: string;
  playerIds: readonly [string, string, string];
  hands: Record<string, CardId[]>;
  bottomCards: CardId[];
  bidding: BiddingState;
  landlordPlayerId?: string;
  currentPlayerId: string;
  trickLeaderPlayerId?: string;
  currentCombination?: PlayedCombination;
  consecutivePasses: number;
  successfulPlayCount: Record<string, number>;
  bombCount: number;
  winner?: "landlord" | "farmers";
  result?: ScoreResult;
  processedRequestIds: string[];
};

type CommandEnvelope = {
  actorPlayerId: string;
  requestId: string;
  actionId: string;
  stateRevision: number;
};

export type DouDizhuCommand =
  | (CommandEnvelope & { type: "bid"; bid: Bid })
  | (CommandEnvelope & { type: "play_cards"; cardIds: string[] })
  | (CommandEnvelope & { type: "pass" })
  | (CommandEnvelope & { type: "restart_game" });

export type DouDizhuConfig = {
  rulesVersion: typeof DOUDIZHU_RULES_VERSION;
};

export type DouDizhuPublicView = {
  rulesVersion: typeof DOUDIZHU_RULES_VERSION;
  phase: DouDizhuPhase;
  revision: number;
  actionId: string;
  playerIds: readonly [string, string, string];
  currentPlayerId: string;
  landlordPlayerId: string | undefined;
  bottomCards: CardId[];
  handCounts: Record<string, number>;
  bidding: BiddingState;
  currentCombination: PlayedCombination | undefined;
  consecutivePasses: number;
  bombCount: number;
  winner: "landlord" | "farmers" | undefined;
  result: ScoreResult | undefined;
};

export type DouDizhuPlayerView = DouDizhuPublicView & {
  hand: CardId[];
};
