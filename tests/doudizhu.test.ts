import { describe, expect, it } from "vitest";
import { createBiddingState, submitBid } from "../src/games/doudizhu/bidding.js";
import { createDeck, type Card, type Rank } from "../src/games/doudizhu/cards.js";
import { parseCombination, type CombinationType } from "../src/games/doudizhu/combinations.js";
import { canBeat } from "../src/games/doudizhu/comparison.js";
import { dealThreePlayerGame } from "../src/games/doudizhu/deal.js";
import { calculateScore } from "../src/games/doudizhu/scoring.js";

function cards(...ranks: Rank[]): Card[] {
  const deck = createDeck();
  const used = new Set<string>();
  return ranks.map(rank => {
    const card = deck.find(candidate => candidate.rank === rank && !used.has(candidate.id));
    if (!card) throw new Error(`No card available for rank ${rank}`);
    used.add(card.id);
    return card;
  });
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return (maxExclusive: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

describe("doudizhu deck and deal", () => {
  it("builds exactly 54 unique cards in classic rank order", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map(card => card.id)).size).toBe(54);
    expect(deck.filter(card => card.rank >= 3 && card.rank <= 15)).toHaveLength(52);
    expect(deck.filter(card => card.rank === 16 || card.rank === 17)).toHaveLength(2);
  });

  it("deals 17 cards to each player and keeps three bottom cards", () => {
    const deal = dealThreePlayerGame(["one", "two", "three"], seededRandom(42));
    expect(Object.values(deal.hands).map(hand => hand.length)).toEqual([17, 17, 17]);
    expect(deal.bottomCards).toHaveLength(3);
    const allCards = [...Object.values(deal.hands).flat(), ...deal.bottomCards];
    expect(allCards).toHaveLength(54);
    expect(new Set(allCards.map(card => card.id)).size).toBe(54);
  });

  it("replays the same deal with the same injected random seed", () => {
    const first = dealThreePlayerGame(["one", "two", "three"], seededRandom(2026));
    const second = dealThreePlayerGame(["one", "two", "three"], seededRandom(2026));
    expect(second.deckOrder.map(card => card.id)).toEqual(first.deckOrder.map(card => card.id));
  });

  it("rejects invalid player sets and invalid random sources", () => {
    expect(() => dealThreePlayerGame(["one", "two"])).toThrow("标准斗地主必须由三名不同玩家参加");
    expect(() => dealThreePlayerGame(["one", "one", "three"])).toThrow(
      "标准斗地主必须由三名不同玩家参加",
    );
    expect(() => dealThreePlayerGame(["one", "two", "three"], max => max)).toThrow(
      "随机数生成器返回了无效结果",
    );
  });
});

describe("doudizhu bidding", () => {
  const players = ["one", "two", "three"] as const;

  it("moves once around the table and awards the highest bid", () => {
    let state = createBiddingState(players, 1);
    state = submitBid(state, "two", 1);
    state = submitBid(state, "three", 0);
    state = submitBid(state, "one", 2);
    expect(state).toMatchObject({
      completed: true,
      highestBid: 2,
      highestBidderId: "one",
      landlordPlayerId: "one",
      redealRequired: false,
    });
  });

  it("ends immediately when a player bids three", () => {
    const state = submitBid(createBiddingState(players, 0), "one", 3);
    expect(state).toMatchObject({
      completed: true,
      highestBid: 3,
      landlordPlayerId: "one",
      actions: [{ playerId: "one", bid: 3 }],
    });
  });

  it("requires a higher bid and the correct current player", () => {
    const state = submitBid(createBiddingState(players, 0), "one", 2);
    expect(() => submitBid(state, "three", 3)).toThrow("尚未轮到该玩家叫分");
    expect(() => submitBid(state, "two", 2)).toThrow("叫分必须高于当前最高分");
    expect(() => submitBid(state, "two", 1)).toThrow("叫分必须高于当前最高分");
  });

  it("requests a redeal and rotates the first bidder when everyone passes", () => {
    let state = createBiddingState(players, 2);
    state = submitBid(state, "three", 0);
    state = submitBid(state, "one", 0);
    state = submitBid(state, "two", 0);
    expect(state).toMatchObject({
      completed: true,
      highestBid: 0,
      redealRequired: true,
      nextFirstBidderIndex: 0,
    });
  });
});

describe("doudizhu classic-v1 combinations", () => {
  const cases: Array<[CombinationType, Rank[]]> = [
    ["single", [3]],
    ["pair", [4, 4]],
    ["triple", [5, 5, 5]],
    ["triple_single", [6, 6, 6, 9]],
    ["triple_pair", [7, 7, 7, 10, 10]],
    ["straight", [3, 4, 5, 6, 7]],
    ["consecutive_pairs", [3, 3, 4, 4, 5, 5]],
    ["airplane", [3, 3, 3, 4, 4, 4]],
    ["airplane_singles", [3, 3, 3, 4, 4, 4, 8, 9]],
    ["airplane_pairs", [3, 3, 3, 4, 4, 4, 8, 8, 9, 9]],
    ["four_two_singles", [7, 7, 7, 7, 9, 9]],
    ["four_two_pairs", [7, 7, 7, 7, 9, 9, 10, 10]],
    ["bomb", [11, 11, 11, 11]],
    ["rocket", [16, 17]],
  ];

  it.each(cases)("parses %s", (type, ranks) => {
    expect(parseCombination(cards(...ranks))).toMatchObject({ type, cardCount: ranks.length });
  });

  it("rejects unsupported or malformed combinations", () => {
    expect(() => parseCombination([])).toThrow("至少选择一张牌");
    expect(() => parseCombination(cards(3, 4, 5, 6))).toThrow("不符合");
    expect(() => parseCombination(cards(11, 12, 13, 14, 15))).toThrow("不符合");
    expect(() => parseCombination(cards(3, 3, 3, 3, 4, 4, 4, 8))).toThrow("不符合");
    const repeated = cards(3)[0]!;
    expect(() => parseCombination([repeated, repeated])).toThrow("不能重复使用同一张牌");
  });

  it("records normalized chain length and main rank", () => {
    expect(parseCombination(cards(5, 6, 7, 8, 9))).toEqual({
      type: "straight",
      mainRank: 9,
      cardCount: 5,
      chainLength: 5,
    });
    expect(parseCombination(cards(6, 6, 6, 7, 7, 7))).toMatchObject({
      type: "airplane",
      mainRank: 7,
      chainLength: 2,
    });
  });
});

describe("doudizhu combination comparison", () => {
  it("lets rockets and bombs override ordinary combinations", () => {
    const straight = parseCombination(cards(3, 4, 5, 6, 7));
    const bomb = parseCombination(cards(4, 4, 4, 4));
    const higherBomb = parseCombination(cards(5, 5, 5, 5));
    const rocket = parseCombination(cards(16, 17));
    expect(canBeat(bomb, straight)).toBe(true);
    expect(canBeat(higherBomb, bomb)).toBe(true);
    expect(canBeat(bomb, higherBomb)).toBe(false);
    expect(canBeat(rocket, higherBomb)).toBe(true);
    expect(canBeat(higherBomb, rocket)).toBe(false);
  });

  it("requires the same ordinary type, card count, and chain length", () => {
    expect(canBeat(
      parseCombination(cards(4, 5, 6, 7, 8)),
      parseCombination(cards(3, 4, 5, 6, 7)),
    )).toBe(true);
    expect(canBeat(
      parseCombination(cards(4, 5, 6, 7, 8, 9)),
      parseCombination(cards(3, 4, 5, 6, 7)),
    )).toBe(false);
    expect(canBeat(
      parseCombination(cards(8, 8)),
      parseCombination(cards(7)),
    )).toBe(false);
  });
});

describe("doudizhu scoring", () => {
  const playerIds = ["landlord", "farmer-one", "farmer-two"] as const;

  it("scores a landlord win with bombs and spring", () => {
    expect(calculateScore({
      playerIds,
      landlordPlayerId: "landlord",
      baseBid: 2,
      bombCount: 2,
      successfulPlayCount: { landlord: 6, "farmer-one": 0, "farmer-two": 0 },
      winner: "landlord",
    })).toEqual({
      baseScore: 2,
      multiplier: 8,
      unitScore: 16,
      bombCount: 2,
      spring: true,
      antiSpring: false,
      winner: "landlord",
      points: { landlord: 32, "farmer-one": -16, "farmer-two": -16 },
    });
  });

  it("scores a farmer win with anti-spring", () => {
    expect(calculateScore({
      playerIds,
      landlordPlayerId: "landlord",
      baseBid: 3,
      bombCount: 0,
      successfulPlayCount: { landlord: 1, "farmer-one": 5, "farmer-two": 2 },
      winner: "farmers",
    })).toMatchObject({
      multiplier: 2,
      unitScore: 6,
      spring: false,
      antiSpring: true,
      points: { landlord: -12, "farmer-one": 6, "farmer-two": 6 },
    });
  });

  it("rejects invalid scoring inputs", () => {
    expect(() => calculateScore({
      playerIds,
      landlordPlayerId: "outsider",
      baseBid: 1,
      bombCount: 0,
      successfulPlayCount: {},
      winner: "landlord",
    })).toThrow("地主必须是本局玩家");
    expect(() => calculateScore({
      playerIds,
      landlordPlayerId: "landlord",
      baseBid: 1,
      bombCount: -1,
      successfulPlayCount: {},
      winner: "landlord",
    })).toThrow("炸弹数量无效");
  });
});
