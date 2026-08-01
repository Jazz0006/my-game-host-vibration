import { DouDizhuRuleError } from "./errors.js";

export type DouDizhuWinner = "landlord" | "farmers";

export type ScoreInput = {
  playerIds: readonly [string, string, string];
  landlordPlayerId: string;
  baseBid: 1 | 2 | 3;
  bombCount: number;
  successfulPlayCount: Readonly<Record<string, number>>;
  winner: DouDizhuWinner;
};

export type ScoreResult = {
  baseScore: number;
  multiplier: number;
  unitScore: number;
  bombCount: number;
  spring: boolean;
  antiSpring: boolean;
  winner: DouDizhuWinner;
  points: Record<string, number>;
};

export function calculateScore(input: ScoreInput): ScoreResult {
  if (new Set(input.playerIds).size !== 3) {
    throw new DouDizhuRuleError("计分必须包含三名不同玩家");
  }
  if (!input.playerIds.includes(input.landlordPlayerId)) {
    throw new DouDizhuRuleError("地主必须是本局玩家");
  }
  if (![1, 2, 3].includes(input.baseBid)) {
    throw new DouDizhuRuleError("基础分必须是最终叫分");
  }
  if (!Number.isInteger(input.bombCount) || input.bombCount < 0) {
    throw new DouDizhuRuleError("炸弹数量无效");
  }
  if (input.playerIds.some(playerId => {
    const count = input.successfulPlayCount[playerId] ?? 0;
    return !Number.isInteger(count) || count < 0;
  })) {
    throw new DouDizhuRuleError("成功出牌次数无效");
  }
  const farmers = input.playerIds.filter(playerId => playerId !== input.landlordPlayerId);
  const spring = input.winner === "landlord" && farmers.every(
    playerId => (input.successfulPlayCount[playerId] ?? 0) === 0,
  );
  const antiSpring = input.winner === "farmers" &&
    (input.successfulPlayCount[input.landlordPlayerId] ?? 0) === 1;
  const multiplier = 2 ** input.bombCount * (spring || antiSpring ? 2 : 1);
  const unitScore = input.baseBid * multiplier;
  const landlordPoints = (input.winner === "landlord" ? 2 : -2) * unitScore;
  const farmerPoints = (input.winner === "farmers" ? 1 : -1) * unitScore;
  return {
    baseScore: input.baseBid,
    multiplier,
    unitScore,
    bombCount: input.bombCount,
    spring,
    antiSpring,
    winner: input.winner,
    points: Object.fromEntries(input.playerIds.map(playerId => [
      playerId,
      playerId === input.landlordPlayerId ? landlordPoints : farmerPoints,
    ])),
  };
}
