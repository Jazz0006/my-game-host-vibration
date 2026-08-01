import crypto from "node:crypto";
import type {
  GameEngine,
  GameEvent,
  GameTransition,
  GameViewContext,
} from "../shared/engine.js";
import { GAME_METADATA } from "../shared/metadata.js";
import { createBiddingState, submitBid } from "./bidding.js";
import { compareCards, createDeck, type Card, type CardId } from "./cards.js";
import { parseCombination } from "./combinations.js";
import { canBeat } from "./comparison.js";
import { dealThreePlayerGame, type RandomInt } from "./deal.js";
import { DouDizhuRuleError } from "./errors.js";
import { calculateScore } from "./scoring.js";
import {
  DOUDIZHU_RULES_VERSION,
  type DouDizhuCommand,
  type DouDizhuConfig,
  type DouDizhuGameState,
  type DouDizhuPlayerView,
  type DouDizhuPublicView,
} from "./state.js";

const metadata = GAME_METADATA.find(game => game.kind === "doudizhu")!;
const CARD_BY_ID = new Map(createDeck().map(card => [card.id, card]));
const MAX_PROCESSED_REQUESTS = 100;

export type DouDizhuEngineOptions = {
  randomInt?: RandomInt;
  nextActionId?: () => string;
};

function nextPlayerId(
  playerIds: readonly [string, string, string],
  currentPlayerId: string,
): string {
  const currentIndex = playerIds.indexOf(currentPlayerId);
  if (currentIndex < 0) throw new DouDizhuRuleError("当前行动玩家不存在");
  return playerIds[(currentIndex + 1) % 3]!;
}

function sortCardIds(cardIds: readonly CardId[]): CardId[] {
  return [...cardIds].sort((left, right) => compareCards(CARD_BY_ID.get(left)!, CARD_BY_ID.get(right)!));
}

function playerTuple(playerIds: readonly string[]): readonly [string, string, string] {
  if (playerIds.length !== 3 || new Set(playerIds).size !== 3) {
    throw new DouDizhuRuleError("标准斗地主必须由三名不同玩家参加");
  }
  return [playerIds[0]!, playerIds[1]!, playerIds[2]!];
}

export function createDouDizhuEngine(options: DouDizhuEngineOptions = {}): GameEngine<
  DouDizhuGameState,
  DouDizhuConfig,
  DouDizhuCommand,
  DouDizhuPlayerView,
  DouDizhuPublicView
> {
  const randomInt = options.randomInt ?? (maxExclusive => crypto.randomInt(maxExclusive));
  const nextActionId = options.nextActionId ?? (() => crypto.randomUUID());

  function buildRound(
    playerIds: readonly [string, string, string],
    firstBidderIndex: number,
  ): DouDizhuGameState {
    const deal = dealThreePlayerGame(playerIds, randomInt);
    return {
      rulesVersion: DOUDIZHU_RULES_VERSION,
      phase: "bidding",
      revision: 0,
      actionId: nextActionId(),
      playerIds,
      hands: Object.fromEntries(playerIds.map(playerId => [
        playerId,
        deal.hands[playerId]!.map(card => card.id),
      ])),
      bottomCards: deal.bottomCards.map(card => card.id),
      bidding: createBiddingState(playerIds, firstBidderIndex),
      currentPlayerId: playerIds[firstBidderIndex]!,
      consecutivePasses: 0,
      successfulPlayCount: Object.fromEntries(playerIds.map(playerId => [playerId, 0])),
      bombCount: 0,
      processedRequestIds: [],
    };
  }

  function commit(
    state: DouDizhuGameState,
    requestId: string,
    events: GameEvent[],
  ): GameTransition<DouDizhuGameState> {
    state.revision += 1;
    state.actionId = nextActionId();
    state.processedRequestIds = [...state.processedRequestIds, requestId]
      .slice(-MAX_PROCESSED_REQUESTS);
    return { state, events, changed: true };
  }

  function validateEnvelope(state: DouDizhuGameState, command: DouDizhuCommand): void {
    if (!command.requestId.trim()) throw new DouDizhuRuleError("requestId 不能为空");
    if (!state.playerIds.includes(command.actorPlayerId)) {
      throw new DouDizhuRuleError("玩家不属于当前对局");
    }
    if (command.actionId !== state.actionId) throw new DouDizhuRuleError("操作已经过期");
    if (command.stateRevision !== state.revision) throw new DouDizhuRuleError("游戏状态已经更新");
  }

  function handleBid(
    state: DouDizhuGameState,
    command: Extract<DouDizhuCommand, { type: "bid" }>,
  ): GameTransition<DouDizhuGameState> {
    if (state.phase !== "bidding") throw new DouDizhuRuleError("当前不在叫分阶段");
    const bidding = submitBid(state.bidding, command.actorPlayerId, command.bid);
    state.bidding = bidding;
    state.currentPlayerId = bidding.completed
      ? state.currentPlayerId
      : bidding.playerIds[bidding.currentBidderIndex]!;

    if (bidding.redealRequired) {
      const replacement = buildRound(state.playerIds, bidding.nextFirstBidderIndex!);
      replacement.revision = state.revision;
      replacement.processedRequestIds = state.processedRequestIds;
      return commit(replacement, command.requestId, [{ type: "doudizhu:redealt" }]);
    }

    if (bidding.landlordPlayerId) {
      const landlordPlayerId = bidding.landlordPlayerId;
      state.landlordPlayerId = landlordPlayerId;
      state.hands[landlordPlayerId] = sortCardIds([
        ...state.hands[landlordPlayerId]!,
        ...state.bottomCards,
      ]);
      state.phase = "playing";
      state.currentPlayerId = landlordPlayerId;
      state.trickLeaderPlayerId = landlordPlayerId;
      return commit(state, command.requestId, [{
        type: "doudizhu:landlord-selected",
        payload: { landlordPlayerId, bid: bidding.highestBid, bottomCards: state.bottomCards },
      }]);
    }

    return commit(state, command.requestId, [{
      type: "doudizhu:bid",
      payload: { playerId: command.actorPlayerId, bid: command.bid },
    }]);
  }

  function selectedCards(state: DouDizhuGameState, playerId: string, rawIds: string[]): {
    cardIds: CardId[];
    cards: Card[];
  } {
    if (rawIds.length === 0) throw new DouDizhuRuleError("至少选择一张牌");
    if (new Set(rawIds).size !== rawIds.length) throw new DouDizhuRuleError("不能重复使用同一张牌");
    const hand = new Set(state.hands[playerId]);
    const cardIds = rawIds.map(rawId => {
      if (!CARD_BY_ID.has(rawId as CardId)) throw new DouDizhuRuleError("提交了未知的牌");
      if (!hand.has(rawId as CardId)) throw new DouDizhuRuleError("只能打出自己手牌中的牌");
      return rawId as CardId;
    });
    return { cardIds, cards: cardIds.map(cardId => CARD_BY_ID.get(cardId)!) };
  }

  function handlePlay(
    state: DouDizhuGameState,
    command: Extract<DouDizhuCommand, { type: "play_cards" }>,
  ): GameTransition<DouDizhuGameState> {
    if (state.phase !== "playing") throw new DouDizhuRuleError("当前不在出牌阶段");
    if (command.actorPlayerId !== state.currentPlayerId) throw new DouDizhuRuleError("尚未轮到该玩家出牌");
    const selection = selectedCards(state, command.actorPlayerId, command.cardIds);
    const combination = parseCombination(selection.cards);
    if (state.currentCombination && !canBeat(combination, state.currentCombination.combination)) {
      throw new DouDizhuRuleError("所选牌无法压过当前牌型");
    }

    const played = new Set(selection.cardIds);
    state.hands[command.actorPlayerId] = state.hands[command.actorPlayerId]!
      .filter(cardId => !played.has(cardId));
    state.currentCombination = {
      playerId: command.actorPlayerId,
      cardIds: sortCardIds(selection.cardIds),
      combination,
    };
    state.trickLeaderPlayerId = command.actorPlayerId;
    state.consecutivePasses = 0;
    state.successfulPlayCount[command.actorPlayerId] =
      (state.successfulPlayCount[command.actorPlayerId] ?? 0) + 1;
    if (combination.type === "bomb" || combination.type === "rocket") state.bombCount += 1;

    const events: GameEvent[] = [{
      type: "doudizhu:cards-played",
      payload: {
        playerId: command.actorPlayerId,
        cardIds: state.currentCombination.cardIds,
        combination,
      },
    }];
    if (state.hands[command.actorPlayerId]!.length === 0) {
      const winner = command.actorPlayerId === state.landlordPlayerId ? "landlord" : "farmers";
      const baseBid = state.bidding.highestBid;
      if (baseBid === 0 || !state.landlordPlayerId) throw new DouDizhuRuleError("对局缺少有效地主");
      state.phase = "game_over";
      state.winner = winner;
      state.result = calculateScore({
        playerIds: state.playerIds,
        landlordPlayerId: state.landlordPlayerId,
        baseBid,
        bombCount: state.bombCount,
        successfulPlayCount: state.successfulPlayCount,
        winner,
      });
      events.push({ type: "doudizhu:game-over", payload: state.result });
    } else {
      state.currentPlayerId = nextPlayerId(state.playerIds, command.actorPlayerId);
    }
    return commit(state, command.requestId, events);
  }

  function handlePass(
    state: DouDizhuGameState,
    command: Extract<DouDizhuCommand, { type: "pass" }>,
  ): GameTransition<DouDizhuGameState> {
    if (state.phase !== "playing") throw new DouDizhuRuleError("当前不在出牌阶段");
    if (command.actorPlayerId !== state.currentPlayerId) throw new DouDizhuRuleError("尚未轮到该玩家出牌");
    if (!state.currentCombination || command.actorPlayerId === state.trickLeaderPlayerId) {
      throw new DouDizhuRuleError("拥有自由出牌权时不能不要");
    }
    state.consecutivePasses += 1;
    if (state.consecutivePasses === 2) {
      state.currentPlayerId = state.trickLeaderPlayerId!;
      state.consecutivePasses = 0;
      delete state.currentCombination;
    } else {
      state.currentPlayerId = nextPlayerId(state.playerIds, command.actorPlayerId);
    }
    return commit(state, command.requestId, [{
      type: "doudizhu:passed",
      payload: { playerId: command.actorPlayerId },
    }]);
  }

  function projectPublicView(state: DouDizhuGameState): DouDizhuPublicView {
    return {
      rulesVersion: state.rulesVersion,
      phase: state.phase,
      revision: state.revision,
      actionId: state.actionId,
      playerIds: state.playerIds,
      currentPlayerId: state.currentPlayerId,
      landlordPlayerId: state.landlordPlayerId,
      bottomCards: state.landlordPlayerId ? state.bottomCards : [],
      handCounts: Object.fromEntries(state.playerIds.map(playerId => [
        playerId,
        state.hands[playerId]!.length,
      ])),
      bidding: state.bidding,
      currentCombination: state.currentCombination,
      consecutivePasses: state.consecutivePasses,
      bombCount: state.bombCount,
      winner: state.winner,
      result: state.result,
    };
  }

  return {
    metadata,

    createConfig(playerCount, input) {
      if (playerCount !== 3) throw new DouDizhuRuleError("标准斗地主固定为三名玩家");
      if (
        input &&
        typeof input === "object" &&
        "rulesVersion" in input &&
        input.rulesVersion !== DOUDIZHU_RULES_VERSION
      ) {
        throw new DouDizhuRuleError("不支持的斗地主规则版本");
      }
      return { rulesVersion: DOUDIZHU_RULES_VERSION };
    },

    createInitialState({ playerIds, config }) {
      if (config.rulesVersion !== DOUDIZHU_RULES_VERSION) {
        throw new DouDizhuRuleError("不支持的斗地主规则版本");
      }
      const players = playerTuple(playerIds);
      return buildRound(players, randomInt(3));
    },

    handleCommand(state, command) {
      if (state.processedRequestIds.includes(command.requestId)) {
        return { state, events: [], changed: false };
      }
      validateEnvelope(state, command);
      switch (command.type) {
        case "bid": return handleBid(state, command);
        case "play_cards": return handlePlay(state, command);
        case "pass": return handlePass(state, command);
        case "restart_game": {
          const replacement = buildRound(state.playerIds, randomInt(3));
          replacement.revision = state.revision;
          replacement.processedRequestIds = state.processedRequestIds;
          return commit(replacement, command.requestId, [{ type: "doudizhu:restarted" }]);
        }
      }
    },

    projectPlayerView(state, viewerPlayerId, _context) {
      if (!state.playerIds.includes(viewerPlayerId)) throw new DouDizhuRuleError("玩家不属于当前对局");
      return {
        ...projectPublicView(state),
        hand: state.hands[viewerPlayerId]!,
      };
    },

    projectPublicView,

    projectLobbyView() {
      return { rulesVersion: DOUDIZHU_RULES_VERSION };
    },

    actingPlayerIds(state) {
      return state.phase === "game_over" ? [] : [state.currentPlayerId];
    },
  };
}

export const doudizhuEngine = createDouDizhuEngine();
