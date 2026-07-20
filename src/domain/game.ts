import crypto from "node:crypto";

export const FIVE_PLAYER_COUNT = 5;

export type Role = "werewolf" | "seer" | "witch" | "villager";
export type GamePhase =
  | "role_reveal"
  | "night_werewolf"
  | "night_witch"
  | "night_seer"
  | "night_complete";

export type GameState = {
  phase: GamePhase;
  nightNumber: 1;
  roles: Record<string, Role>;
  confirmedRolePlayerIds: string[];
  actionId: string;
  wolfTargetId?: string;
  witchUsedAntidote: boolean;
  witchPoisonTargetId?: string;
  seerTargetId?: string;
  seerResultConfirmed: boolean;
  deaths: string[];
};

export class GameRuleError extends Error {}

const ROLE_DECK: readonly Role[] = ["werewolf", "seer", "witch", "villager", "villager"];

function nextActionId(): string {
  return crypto.randomUUID();
}

export function dealRoles(
  playerIds: readonly string[],
  randomInt: (maxExclusive: number) => number = max => crypto.randomInt(max),
): Record<string, Role> {
  if (playerIds.length !== FIVE_PLAYER_COUNT || new Set(playerIds).size !== FIVE_PLAYER_COUNT) {
    throw new GameRuleError("5人局必须恰好有5名不同的玩家");
  }

  const deck = [...ROLE_DECK];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new GameRuleError("随机数生成器返回了无效结果");
    }
    [deck[index], deck[swapIndex]] = [deck[swapIndex]!, deck[index]!];
  }

  return Object.fromEntries(playerIds.map((playerId, index) => [playerId, deck[index]!]));
}

export function startFivePlayerGame(playerIds: readonly string[]): GameState {
  return {
    phase: "role_reveal",
    nightNumber: 1,
    roles: dealRoles(playerIds),
    confirmedRolePlayerIds: [],
    actionId: nextActionId(),
    witchUsedAntidote: false,
    seerResultConfirmed: false,
    deaths: [],
  };
}

function assertAction(state: GameState, actionId: string | undefined, phase: GamePhase): void {
  if (state.phase !== phase || !actionId || state.actionId !== actionId) {
    throw new GameRuleError("该行动已失效，请按当前页面重新操作");
  }
}

function assertRole(state: GameState, playerId: string, role: Role): void {
  if (state.roles[playerId] !== role) throw new GameRuleError("当前不是你的行动阶段");
}

function assertKnownPlayer(state: GameState, playerId: string | undefined): asserts playerId is string {
  if (!playerId || !state.roles[playerId]) throw new GameRuleError("请选择有效玩家");
}

export function confirmRole(state: GameState, playerId: string, actionId?: string): boolean {
  if (state.confirmedRolePlayerIds.includes(playerId)) return false;
  assertAction(state, actionId, "role_reveal");
  assertKnownPlayer(state, playerId);

  state.confirmedRolePlayerIds.push(playerId);
  if (state.confirmedRolePlayerIds.length === FIVE_PLAYER_COUNT) {
    state.phase = "night_werewolf";
    state.actionId = nextActionId();
    return true;
  }
  return false;
}

export function submitWolfTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | undefined,
  actionId?: string,
): boolean {
  if (
    state.wolfTargetId === targetPlayerId &&
    state.roles[actorPlayerId] === "werewolf" &&
    state.phase !== "night_werewolf"
  ) return false;
  assertAction(state, actionId, "night_werewolf");
  assertRole(state, actorPlayerId, "werewolf");
  assertKnownPlayer(state, targetPlayerId);
  if (targetPlayerId === actorPlayerId || state.roles[targetPlayerId] === "werewolf") {
    throw new GameRuleError("狼人不能选择狼人作为击杀目标");
  }

  state.wolfTargetId = targetPlayerId;
  state.phase = "night_witch";
  state.actionId = nextActionId();
  return true;
}

export function submitWitchAction(
  state: GameState,
  actorPlayerId: string,
  action: { useAntidote?: boolean; poisonTargetId?: string | null },
  actionId?: string,
): boolean {
  const requestedAntidote = action.useAntidote === true;
  const requestedPoison = action.poisonTargetId || undefined;
  if (
    state.phase !== "night_witch" &&
    state.roles[actorPlayerId] === "witch" &&
    state.witchUsedAntidote === requestedAntidote &&
    state.witchPoisonTargetId === requestedPoison
  ) return false;
  assertAction(state, actionId, "night_witch");
  assertRole(state, actorPlayerId, "witch");

  const useAntidote = requestedAntidote;
  const poisonTargetId = requestedPoison;
  if (useAntidote && poisonTargetId) throw new GameRuleError("同一晚只能使用一瓶药");
  if (poisonTargetId) {
    assertKnownPlayer(state, poisonTargetId);
    if (poisonTargetId === actorPlayerId) throw new GameRuleError("女巫不能毒杀自己");
  }

  state.witchUsedAntidote = useAntidote;
  if (poisonTargetId) state.witchPoisonTargetId = poisonTargetId;
  else delete state.witchPoisonTargetId;
  state.phase = "night_seer";
  state.actionId = nextActionId();
  return true;
}

export function submitSeerTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | undefined,
  actionId?: string,
): Role {
  if (
    state.seerTargetId &&
    state.seerTargetId === targetPlayerId &&
    state.roles[actorPlayerId] === "seer"
  ) {
    return state.roles[state.seerTargetId]!;
  }
  assertAction(state, actionId, "night_seer");
  assertRole(state, actorPlayerId, "seer");
  assertKnownPlayer(state, targetPlayerId);
  if (targetPlayerId === actorPlayerId) throw new GameRuleError("预言家不能查验自己");
  if (state.seerTargetId) throw new GameRuleError("查验目标已经提交，请确认查验结果");

  state.seerTargetId = targetPlayerId;
  return state.roles[targetPlayerId]!;
}

export function confirmSeerResult(
  state: GameState,
  actorPlayerId: string,
  actionId?: string,
): boolean {
  if (
    state.phase === "night_complete" &&
    state.seerResultConfirmed &&
    state.roles[actorPlayerId] === "seer"
  ) return false;
  assertAction(state, actionId, "night_seer");
  assertRole(state, actorPlayerId, "seer");
  if (!state.seerTargetId) throw new GameRuleError("请先选择查验目标");

  state.seerResultConfirmed = true;
  const deaths = new Set<string>();
  if (state.wolfTargetId && !state.witchUsedAntidote) deaths.add(state.wolfTargetId);
  if (state.witchPoisonTargetId) deaths.add(state.witchPoisonTargetId);
  state.deaths = [...deaths];
  state.phase = "night_complete";
  state.actionId = nextActionId();
  return true;
}

export function playerIdForRole(state: GameState, role: Role): string {
  const entry = Object.entries(state.roles).find(([, assignedRole]) => assignedRole === role);
  if (!entry) throw new GameRuleError(`本局缺少角色：${role}`);
  return entry[0];
}
