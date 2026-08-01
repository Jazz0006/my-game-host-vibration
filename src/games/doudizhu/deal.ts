import crypto from "node:crypto";
import { compareCards, createDeck, type Card } from "./cards.js";
import { DouDizhuRuleError } from "./errors.js";

export type RandomInt = (maxExclusive: number) => number;

export type DealResult = {
  hands: Record<string, Card[]>;
  bottomCards: Card[];
  deckOrder: Card[];
};

export function shuffleDeck(
  cards: readonly Card[],
  randomInt: RandomInt = maxExclusive => crypto.randomInt(maxExclusive),
): Card[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new DouDizhuRuleError("随机数生成器返回了无效结果");
    }
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function dealThreePlayerGame(
  playerIds: readonly string[],
  randomInt?: RandomInt,
): DealResult {
  if (playerIds.length !== 3 || new Set(playerIds).size !== 3) {
    throw new DouDizhuRuleError("标准斗地主必须由三名不同玩家参加");
  }
  const deckOrder = shuffleDeck(createDeck(), randomInt);
  const hands: Record<string, Card[]> = Object.fromEntries(
    playerIds.map(playerId => [playerId, [] as Card[]]),
  );
  for (let index = 0; index < 51; index += 1) {
    hands[playerIds[index % 3]!]!.push(deckOrder[index]!);
  }
  for (const hand of Object.values(hands)) hand.sort(compareCards);
  return {
    hands,
    bottomCards: deckOrder.slice(51).sort(compareCards),
    deckOrder,
  };
}
