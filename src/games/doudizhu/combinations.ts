import type { Card, Rank } from "./cards.js";
import { DouDizhuRuleError } from "./errors.js";

export type CombinationType =
  | "single"
  | "pair"
  | "triple"
  | "triple_single"
  | "triple_pair"
  | "straight"
  | "consecutive_pairs"
  | "airplane"
  | "airplane_singles"
  | "airplane_pairs"
  | "four_two_singles"
  | "four_two_pairs"
  | "bomb"
  | "rocket";

export type Combination = {
  type: CombinationType;
  mainRank: Rank;
  cardCount: number;
  chainLength?: number;
  attachmentKind?: "single" | "pair";
};

type RankCount = { rank: Rank; count: number };

function countRanks(cards: readonly Card[]): RankCount[] {
  const counts = new Map<Rank, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => left.rank - right.rank);
}

function isConsecutive(ranks: readonly Rank[]): boolean {
  return ranks.every((rank, index) => index === 0 || rank === ranks[index - 1]! + 1);
}

function make(
  type: CombinationType,
  mainRank: Rank,
  cardCount: number,
  extra: Pick<Combination, "chainLength" | "attachmentKind"> = {},
): Combination {
  return { type, mainRank, cardCount, ...extra };
}

function findAirplane(
  counts: readonly RankCount[],
  chainLength: number,
  attachmentKind?: "single" | "pair",
): Combination | undefined {
  if (chainLength < 2) return undefined;
  for (let start = 3; start + chainLength - 1 <= 14; start += 1) {
    const mainRanks = Array.from({ length: chainLength }, (_, index) => start + index as Rank);
    if (!mainRanks.every(rank => (counts.find(item => item.rank === rank)?.count ?? 0) >= 3)) {
      continue;
    }
    const remainder = new Map(counts.map(item => [item.rank, item.count]));
    for (const rank of mainRanks) remainder.set(rank, remainder.get(rank)! - 3);
    if (mainRanks.some(rank => remainder.get(rank)! > 0)) continue;
    const wings = [...remainder.entries()].filter(([, count]) => count > 0);
    if (!attachmentKind && wings.length === 0) {
      return make("airplane", mainRanks.at(-1)!, chainLength * 3, { chainLength });
    }
    if (attachmentKind === "single") {
      const wingCardCount = wings.reduce((total, [, count]) => total + count, 0);
      if (wingCardCount === chainLength) {
        return make("airplane_singles", mainRanks.at(-1)!, chainLength * 4, {
          chainLength,
          attachmentKind,
        });
      }
    }
    if (
      attachmentKind === "pair" &&
      wings.length === chainLength &&
      wings.every(([, count]) => count === 2)
    ) {
      return make("airplane_pairs", mainRanks.at(-1)!, chainLength * 5, {
        chainLength,
        attachmentKind,
      });
    }
  }
  return undefined;
}

export function parseCombination(cards: readonly Card[]): Combination {
  if (cards.length === 0) throw new DouDizhuRuleError("至少选择一张牌");
  if (new Set(cards.map(card => card.id)).size !== cards.length) {
    throw new DouDizhuRuleError("不能重复使用同一张牌");
  }
  const counts = countRanks(cards);
  const count = cards.length;

  if (count === 2 && counts.length === 2 && counts[0]!.rank === 16 && counts[1]!.rank === 17) {
    return make("rocket", 17, count);
  }
  if (count === 4 && counts.length === 1) return make("bomb", counts[0]!.rank, count);
  if (count === 1) return make("single", counts[0]!.rank, count);
  if (count === 2 && counts.length === 1) return make("pair", counts[0]!.rank, count);
  if (count === 3 && counts.length === 1) return make("triple", counts[0]!.rank, count);

  const triple = counts.find(item => item.count === 3);
  if (count === 4 && counts.length === 2 && triple) {
    return make("triple_single", triple.rank, count, { attachmentKind: "single" });
  }
  if (count === 5 && counts.length === 2 && triple && counts.some(item => item.count === 2)) {
    return make("triple_pair", triple.rank, count, { attachmentKind: "pair" });
  }

  const ranks = counts.map(item => item.rank);
  if (
    count >= 5 &&
    counts.every(item => item.count === 1) &&
    ranks.at(-1)! <= 14 &&
    isConsecutive(ranks)
  ) {
    return make("straight", ranks.at(-1)!, count, { chainLength: count });
  }
  if (
    count >= 6 &&
    count % 2 === 0 &&
    counts.every(item => item.count === 2) &&
    ranks.at(-1)! <= 14 &&
    isConsecutive(ranks)
  ) {
    return make("consecutive_pairs", ranks.at(-1)!, count, { chainLength: counts.length });
  }

  if (count % 3 === 0) {
    const airplane = findAirplane(counts, count / 3);
    if (airplane) return airplane;
  }
  if (count % 4 === 0) {
    const airplane = findAirplane(counts, count / 4, "single");
    if (airplane) return airplane;
  }
  if (count % 5 === 0) {
    const airplane = findAirplane(counts, count / 5, "pair");
    if (airplane) return airplane;
  }

  const four = counts.find(item => item.count === 4);
  if (count === 6 && four) {
    return make("four_two_singles", four.rank, count, { attachmentKind: "single" });
  }
  if (
    count === 8 &&
    four &&
    counts.filter(item => item.rank !== four.rank).length === 2 &&
    counts.filter(item => item.rank !== four.rank).every(item => item.count === 2)
  ) {
    return make("four_two_pairs", four.rank, count, { attachmentKind: "pair" });
  }

  throw new DouDizhuRuleError("所选牌不符合 doudizhu-classic-v1 支持的牌型");
}
