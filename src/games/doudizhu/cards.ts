export const REGULAR_RANKS = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

export type RegularRank = (typeof REGULAR_RANKS)[number];
export type Rank = RegularRank | 16 | 17;
export type Suit = "clubs" | "diamonds" | "hearts" | "spades" | "joker";
export type CardId = `${Exclude<Suit, "joker">}-${RegularRank}` | "joker-small" | "joker-big";

export type Card = {
  id: CardId;
  rank: Rank;
  suit: Suit;
};

const REGULAR_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;

export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of REGULAR_SUITS) {
    for (const rank of REGULAR_RANKS) {
      cards.push({ id: `${suit}-${rank}`, rank, suit });
    }
  }
  cards.push(
    { id: "joker-small", rank: 16, suit: "joker" },
    { id: "joker-big", rank: 17, suit: "joker" },
  );
  return cards;
}

export function compareCards(left: Card, right: Card): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  return left.id.localeCompare(right.id);
}
