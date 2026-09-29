export const WEREWOLF_MIN_PLAYERS = 5;
export const WEREWOLF_MAX_PLAYERS = 12;

export function isWerewolfPlayerCountSupported(playerCount: number): boolean {
  return Number.isInteger(playerCount) &&
    playerCount >= WEREWOLF_MIN_PLAYERS &&
    playerCount <= WEREWOLF_MAX_PLAYERS;
}
