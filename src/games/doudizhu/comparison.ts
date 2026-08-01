import type { Combination } from "./combinations.js";

export function canBeat(challenger: Combination, current: Combination): boolean {
  if (challenger.type === "rocket") return current.type !== "rocket";
  if (current.type === "rocket") return false;
  if (challenger.type === "bomb") {
    return current.type !== "bomb" || challenger.mainRank > current.mainRank;
  }
  if (current.type === "bomb") return false;
  return (
    challenger.type === current.type &&
    challenger.cardCount === current.cardCount &&
    challenger.chainLength === current.chainLength &&
    challenger.mainRank > current.mainRank
  );
}
