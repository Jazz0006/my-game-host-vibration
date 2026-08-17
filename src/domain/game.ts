import {
  defaultGameRandomSource,
  type GameRandomSource,
} from "./gameRandom.js";

export type Role = "werewolf" | "seer" | "witch" | "guard" | "hunter" | "villager";
export type GamePhase =
  | "role_reveal"
  | "night_start"
  | "night_werewolf"
  | "night_guard"
  | "night_witch"
  | "night_seer"
  | "night_complete"
  | "day_vote"
  | "day_pk"
  | "day_result"
  | "day_hunter"
  | "game_over";

export interface GameConfig {
  playerCount: number;
  roleDeck: readonly Role[];
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  playerCount: 5,
  roleDeck: ["werewolf", "seer", "witch", "villager", "villager"],
};

const PRESET_DECKS: Record<number, readonly Role[]> = {
  5: ["werewolf", "seer", "witch", "villager", "villager"],
  6: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  7: ["werewolf", "werewolf", "seer", "witch", "villager", "villager", "villager"],
  8: ["werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager"],
  9: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager"],
  10: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager"],
  11: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager", "villager"],
  12: ["werewolf", "werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager", "villager"],
};

export const CONFIGURABLE_ROLES: readonly Role[] = [
  "werewolf", "seer", "witch", "guard", "hunter", "villager",
];

export function configFromPlayerCount(playerCount: number): GameConfig {
  const deck = PRESET_DECKS[playerCount];
  if (!deck) throw new GameRuleError(`不支持${playerCount}人局，请选择5到12人`);
  return { playerCount, roleDeck: deck };
}

export function configFromRoleDeck(playerCount: number, roleDeck: readonly Role[]): GameConfig {
  if (!Number.isInteger(playerCount) || playerCount < 5 || playerCount > 12) {
    throw new GameRuleError("仅支持5到12人局");
  }
  if (roleDeck.length !== playerCount) {
    throw new GameRuleError(`身份数量必须与${playerCount}名玩家一致`);
  }
  if (roleDeck.some(role => !CONFIGURABLE_ROLES.includes(role))) {
    throw new GameRuleError("配置中包含暂不支持的身份");
  }

  const count = (role: Role) => roleDeck.filter(item => item === role).length;
  const wolves = count("werewolf");
  if (wolves < 1) throw new GameRuleError("至少需要一名狼人");
  if (wolves >= playerCount - wolves) throw new GameRuleError("开局时狼人数量必须少于好人");
  for (const role of ["seer", "witch", "guard", "hunter"] as const) {
    if (count(role) > 1) throw new GameRuleError("预言家、女巫、守卫和猎人每局最多各一名");
  }
  return { playerCount, roleDeck: [...roleDeck] };
}

export type GameState = {
  config: GameConfig;
  phase: GamePhase;
  nightNumber: number;
  dayNumber: number;
  roles: Record<string, Role>;
  confirmedRolePlayerIds: string[];
  actionId: string;
  wolfTargetId?: string;
  guardProtectedId?: string;
  guardLastProtectedId?: string;
  witchUsedAntidote: boolean;
  witchAntidoteSpent: boolean;
  witchPoisonSpent: boolean;
  witchPoisonTargetId?: string;
  seerTargetId?: string;
  seerResultConfirmed: boolean;
  hunterExecutionTargetId?: string;
  hunterTrigger?: "night" | "day";
  deaths: string[];
  votes: Record<string, string>;
  pkCandidateIds: string[];
  eliminatedTodayId?: string;
  noKillToday?: boolean;
  deadPlayerIds: string[];
  winner?: "wolf" | "village";
};

export class GameRuleError extends Error {}

const NIGHT_ORDER: readonly Role[] = ["guard", "werewolf", "witch", "seer"];

function hasLivingRole(state: GameState, role: Role): boolean {
  return Object.entries(state.roles).some(
    ([playerId, assignedRole]) =>
      assignedRole === role && !state.deadPlayerIds.includes(playerId),
  );
}

function shouldRunNightRole(state: GameState, role: Role): boolean {
  if (!hasLivingRole(state, role)) return false;
  if (role !== "witch") return true;
  const canUseAntidote = !state.witchAntidoteSpent && Boolean(state.wolfTargetId);
  const canUsePoison = !state.witchPoisonSpent;
  return canUseAntidote || canUsePoison;
}

function nightQueue(state: GameState): Role[] {
  return NIGHT_ORDER.filter(role => shouldRunNightRole(state, role));
}

function nextNightPhase(state: GameState, currentRole: Role): GamePhase {
  const currentIndex = NIGHT_ORDER.indexOf(currentRole);
  const next = NIGHT_ORDER.slice(currentIndex + 1).find(role => shouldRunNightRole(state, role));
  return next ? (`night_${next}` as GamePhase) : "night_complete";
}

function resolveNightDeaths(state: GameState): Set<string> {
  const deaths = new Set<string>();
  if (state.wolfTargetId) {
    const guarded = state.wolfTargetId === state.guardProtectedId;
    const saved = state.witchUsedAntidote;
    if (guarded === saved) deaths.add(state.wolfTargetId);
  }
  if (state.witchPoisonTargetId) deaths.add(state.witchPoisonTargetId);
  return deaths;
}

export function checkVictory(state: GameState): "wolf" | "village" | null {
  const alive = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
  const wolves = alive.filter(id => state.roles[id] === "werewolf").length;
  const others = alive.length - wolves;
  if (wolves === 0) return "village";
  if (wolves >= others) return "wolf";
  return null;
}

function applyElimination(state: GameState, targetId: string, random: GameRandomSource): boolean {
  state.deadPlayerIds.push(targetId);
  state.eliminatedTodayId = targetId;
  delete state.noKillToday;

  if (state.roles[targetId] === "hunter") {
    state.hunterTrigger = "day";
    state.phase = "day_hunter";
    state.actionId = random.randomId();
    return false;
  }

  const victory = checkVictory(state);
  if (victory) {
    state.phase = "game_over";
    state.winner = victory;
    state.actionId = random.randomId();
    return true;
  }
  state.phase = "day_result";
  state.actionId = random.randomId();
  return false;
}

export function dealRoles(
  playerIds: readonly string[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
  randomInt: (maxExclusive: number) => number = defaultGameRandomSource.randomInt,
): Record<string, Role> {
  if (playerIds.length !== config.playerCount || new Set(playerIds).size !== config.playerCount) {
    throw new GameRuleError(`${config.playerCount}人局必须恰好有${config.playerCount}名不同的玩家`);
  }
  const deck = [...config.roleDeck];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new GameRuleError("随机数生成器返回了无效结果");
    }
    [deck[index], deck[swapIndex]] = [deck[swapIndex]!, deck[index]!];
  }
  return Object.fromEntries(playerIds.map((playerId, index) => [playerId, deck[index]!]));
}

export function startGame(
  playerIds: readonly string[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
  random: GameRandomSource = defaultGameRandomSource,
): GameState {
  return {
    config,
    phase: "role_reveal",
    nightNumber: 1,
    dayNumber: 0,
    roles: dealRoles(playerIds, config, random.randomInt),
    confirmedRolePlayerIds: [],
    actionId: random.randomId(),
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
  };
}

function assertAction(state: GameState, actionId: string | undefined, phase: GamePhase): void {
  if (state.phase !== phase || !actionId || state.actionId !== actionId) {
    throw new GameRuleError("该行动已失效，请按当前页面重新操作");
  }
}

function assertActionPhases(state: GameState, actionId: string | undefined, phases: GamePhase[]): void {
  if (!phases.includes(state.phase) || !actionId || state.actionId !== actionId) {
    throw new GameRuleError("该行动已失效，请按当前页面重新操作");
  }
}

function assertRole(state: GameState, playerId: string, role: Role): void {
  if (state.roles[playerId] !== role) throw new GameRuleError("当前不是你的行动阶段");
}

function assertLivingRole(state: GameState, playerId: string, role: Role): void {
  assertRole(state, playerId, role);
  if (state.deadPlayerIds.includes(playerId)) {
    throw new GameRuleError("已出局的玩家不能执行夜间行动");
  }
}

function assertKnownPlayer(state: GameState, playerId: string | undefined): asserts playerId is string {
  if (!playerId || !state.roles[playerId]) throw new GameRuleError("请选择有效玩家");
}

function settleNight(state: GameState, random: GameRandomSource): void {
  const deaths = resolveNightDeaths(state);
  state.deaths = [...deaths];

  for (const id of deaths) {
    if (!state.deadPlayerIds.includes(id)) state.deadPlayerIds.push(id);
  }

  const hunterPlayerId = Object.entries(state.roles).find(([, role]) => role === "hunter")?.[0];
  const hunterCanShoot =
    hunterPlayerId !== undefined &&
    deaths.has(hunterPlayerId) &&
    state.witchPoisonTargetId !== hunterPlayerId &&
    Object.keys(state.roles).some(playerId => !state.deadPlayerIds.includes(playerId));

  if (hunterCanShoot) {
    state.hunterTrigger = "night";
    state.phase = "day_hunter";
    state.actionId = random.randomId();
    return;
  }

  const victory = checkVictory(state);
  if (victory) {
    state.phase = "game_over";
    state.winner = victory;
  } else {
    state.phase = "night_complete";
  }
  state.actionId = random.randomId();
}

function advanceAfterNightRole(state: GameState, currentRole: Role, random: GameRandomSource): void {
  const nextPhase = nextNightPhase(state, currentRole);
  if (nextPhase === "night_complete") {
    settleNight(state, random);
    return;
  }
  state.phase = nextPhase;
  state.actionId = random.randomId();
}

export function confirmRole(
  state: GameState,
  playerId: string,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  if (state.confirmedRolePlayerIds.includes(playerId)) return false;
  assertAction(state, actionId, "role_reveal");
  assertKnownPlayer(state, playerId);

  state.confirmedRolePlayerIds.push(playerId);
  if (state.confirmedRolePlayerIds.length === state.config.playerCount) {
    state.phase = "night_start";
    state.actionId = random.randomId();
    return true;
  }
  return false;
}

export function startNight(
  state: GameState,
  random: GameRandomSource = defaultGameRandomSource,
): void {
  if (state.phase !== "night_start") {
    throw new GameRuleError("当前不能开始夜晚流程");
  }
  if (state.guardProtectedId) state.guardLastProtectedId = state.guardProtectedId;
  else delete state.guardLastProtectedId;

  delete state.wolfTargetId;
  delete state.guardProtectedId;
  delete state.witchPoisonTargetId;
  delete state.seerTargetId;
  delete state.hunterExecutionTargetId;
  delete state.hunterTrigger;
  delete state.eliminatedTodayId;
  delete state.noKillToday;
  state.witchUsedAntidote = false;
  state.seerResultConfirmed = false;
  state.deaths = [];
  state.votes = {};
  state.pkCandidateIds = [];

  if (state.dayNumber > 0) state.nightNumber += 1;

  const firstNightRole = nightQueue(state)[0];
  if (firstNightRole) {
    state.phase = `night_${firstNightRole}` as GamePhase;
    state.actionId = random.randomId();
  } else {
    settleNight(state, random);
  }
}

export function submitWolfTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  const requestedTargetId = targetPlayerId ?? undefined;
  if (
    state.wolfTargetId === requestedTargetId &&
    state.roles[actorPlayerId] === "werewolf" &&
    state.phase !== "night_werewolf"
  ) return false;
  assertAction(state, actionId, "night_werewolf");
  assertLivingRole(state, actorPlayerId, "werewolf");
  if (requestedTargetId) {
    assertKnownPlayer(state, requestedTargetId);
    if (state.deadPlayerIds.includes(requestedTargetId)) throw new GameRuleError("不能击杀已出局的玩家");
  }

  if (requestedTargetId) state.wolfTargetId = requestedTargetId;
  else delete state.wolfTargetId;
  advanceAfterNightRole(state, "werewolf", random);
  return true;
}

export function submitGuardTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  const requestedTargetId = targetPlayerId ?? undefined;
  if (
    state.guardProtectedId === requestedTargetId &&
    state.roles[actorPlayerId] === "guard" &&
    state.phase !== "night_guard"
  ) return false;
  assertAction(state, actionId, "night_guard");
  assertLivingRole(state, actorPlayerId, "guard");
  if (requestedTargetId) {
    assertKnownPlayer(state, requestedTargetId);
    if (state.deadPlayerIds.includes(requestedTargetId)) throw new GameRuleError("不能保护已出局的玩家");
    if (requestedTargetId === state.guardLastProtectedId) {
      throw new GameRuleError("不能连续两晚保护同一名玩家");
    }
  }

  if (requestedTargetId) state.guardProtectedId = requestedTargetId;
  else delete state.guardProtectedId;
  advanceAfterNightRole(state, "guard", random);
  return true;
}

export function submitWitchAction(
  state: GameState,
  actorPlayerId: string,
  action: { useAntidote?: boolean; poisonTargetId?: string | null },
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
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
  assertLivingRole(state, actorPlayerId, "witch");

  if (requestedAntidote && requestedPoison) throw new GameRuleError("同一晚只能使用一瓶药");
  if (requestedAntidote && state.witchAntidoteSpent) throw new GameRuleError("解药已经使用过了");
  if (requestedAntidote && !state.wolfTargetId) throw new GameRuleError("今晚没有狼人击杀目标，不能使用解药");
  if (requestedPoison && state.witchPoisonSpent) throw new GameRuleError("毒药已经使用过了");
  if (requestedPoison) {
    assertKnownPlayer(state, requestedPoison);
    if (requestedPoison === actorPlayerId) throw new GameRuleError("女巫不能毒杀自己");
  }

  state.witchUsedAntidote = requestedAntidote;
  if (requestedAntidote) state.witchAntidoteSpent = true;
  if (requestedPoison) {
    state.witchPoisonTargetId = requestedPoison;
    state.witchPoisonSpent = true;
  } else {
    delete state.witchPoisonTargetId;
  }
  advanceAfterNightRole(state, "witch", random);
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
  assertLivingRole(state, actorPlayerId, "seer");
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
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  if (
    (state.phase === "night_complete" || state.phase === "day_hunter" || state.phase === "game_over") &&
    state.seerResultConfirmed &&
    state.roles[actorPlayerId] === "seer"
  ) return false;
  assertAction(state, actionId, "night_seer");
  assertLivingRole(state, actorPlayerId, "seer");
  if (!state.seerTargetId) throw new GameRuleError("请先选择查验目标");

  state.seerResultConfirmed = true;
  settleNight(state, random);
  return true;
}

export function submitHunterExecution(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  const requestedTargetId = targetPlayerId ?? undefined;
  if (
    state.hunterExecutionTargetId === requestedTargetId &&
    state.roles[actorPlayerId] === "hunter" &&
    state.phase !== "day_hunter"
  ) return false;
  assertAction(state, actionId, "day_hunter");
  assertRole(state, actorPlayerId, "hunter");
  if (!state.deadPlayerIds.includes(actorPlayerId)) throw new GameRuleError("猎人尚未死亡");
  if (requestedTargetId) {
    assertKnownPlayer(state, requestedTargetId);
    if (state.deadPlayerIds.includes(requestedTargetId)) throw new GameRuleError("不能选择已死亡的玩家");
    state.hunterExecutionTargetId = requestedTargetId;
    state.deadPlayerIds.push(requestedTargetId);
  } else {
    delete state.hunterExecutionTargetId;
  }

  const triggeredAtNight = state.hunterTrigger === "night";
  delete state.hunterTrigger;
  const victory = checkVictory(state);
  if (victory) {
    state.phase = "game_over";
    state.winner = victory;
  } else {
    state.phase = triggeredAtNight ? "night_complete" : "day_result";
  }
  state.actionId = random.randomId();
  return true;
}

export function startDayVote(
  state: GameState,
  random: GameRandomSource = defaultGameRandomSource,
): void {
  if (state.phase !== "night_complete") {
    throw new GameRuleError("只能在夜间结束后开始白天投票");
  }
  state.dayNumber += 1;
  state.votes = {};
  state.pkCandidateIds = [];
  delete state.eliminatedTodayId;
  delete state.noKillToday;
  state.phase = "day_vote";
  state.actionId = random.randomId();
}

export function submitVote(
  state: GameState,
  voterId: string,
  targetId: string,
  actionId: string,
): boolean {
  assertActionPhases(state, actionId, ["day_vote", "day_pk"]);
  assertKnownPlayer(state, voterId);
  assertKnownPlayer(state, targetId);
  if (state.deadPlayerIds.includes(voterId)) throw new GameRuleError("已出局的玩家不能投票");
  if (state.deadPlayerIds.includes(targetId)) throw new GameRuleError("不能投票给已出局的玩家");
  if (state.phase === "day_pk" && state.pkCandidateIds.includes(voterId)) {
    throw new GameRuleError("PK玩家不能参与PK投票");
  }
  if (voterId === targetId) throw new GameRuleError("不能投票给自己");
  if (state.phase === "day_pk" && !state.pkCandidateIds.includes(targetId)) {
    throw new GameRuleError("请从平票玩家中选择放逐目标");
  }
  if (state.votes[voterId] === targetId) return false;
  state.votes[voterId] = targetId;
  return true;
}

export function allAliveVoted(state: GameState): boolean {
  const eligibleVoterIds = Object.keys(state.roles).filter(
    playerId =>
      !state.deadPlayerIds.includes(playerId) &&
      (state.phase !== "day_pk" || !state.pkCandidateIds.includes(playerId)),
  );
  return eligibleVoterIds.length > 0 && eligibleVoterIds.every(id => id in state.votes);
}

export function closeDayVote(
  state: GameState,
  random: GameRandomSource = defaultGameRandomSource,
): "pk" | "no_kill" | string {
  if (state.phase !== "day_vote" && state.phase !== "day_pk") {
    throw new GameRuleError("当前不在投票阶段");
  }
  const isPk = state.phase === "day_pk";
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(state.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  if (Object.keys(tally).length === 0) {
    if (isPk) {
      state.noKillToday = true;
      delete state.eliminatedTodayId;
      state.phase = "day_result";
      state.actionId = random.randomId();
      return "no_kill";
    }
    state.noKillToday = true;
    state.phase = "day_result";
    state.actionId = random.randomId();
    return "no_kill";
  }

  const maxVotes = Math.max(...Object.values(tally));
  const topCandidates = Object.keys(tally).filter(id => tally[id] === maxVotes);

  if (topCandidates.length === 1) {
    applyElimination(state, topCandidates[0]!, random);
    return topCandidates[0]!;
  }

  if (isPk) {
    state.noKillToday = true;
    delete state.eliminatedTodayId;
    state.phase = "day_result";
    state.actionId = random.randomId();
    return "no_kill";
  }

  state.pkCandidateIds = topCandidates;
  state.votes = {};
  state.phase = "day_pk";
  state.actionId = random.randomId();
  return "pk";
}

export function beginNightStart(
  state: GameState,
  random: GameRandomSource = defaultGameRandomSource,
): void {
  if (state.phase !== "day_result") {
    throw new GameRuleError("当前不能进入夜晚准备阶段");
  }
  state.phase = "night_start";
  state.actionId = random.randomId();
}

export function playerIdForRole(state: GameState, role: Role): string {
  const entry = Object.entries(state.roles).find(([, assignedRole]) => assignedRole === role);
  if (!entry) throw new GameRuleError(`本局缺少角色：${role}`);
  return entry[0];
}
