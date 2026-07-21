import crypto from "node:crypto";

export type Role = "werewolf" | "seer" | "witch" | "guard" | "hunter" | "villager";
export type GamePhase =
  | "role_reveal"
  | "night_start"       // waiting for host to begin the night
  | "night_werewolf"
  | "night_guard"
  | "night_witch"
  | "night_seer"
  | "night_hunter"
  | "night_complete"
  | "day_vote"          // first vote — targets: all alive except self
  | "day_pk"            // tie-break vote — targets: pkCandidateIds only
  | "day_result"        // outcome display; host advances to next night
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
  5:  ["werewolf", "seer", "witch", "villager", "villager"],
  6:  ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  7:  ["werewolf", "werewolf", "seer", "witch", "villager", "villager", "villager"],
  8:  ["werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager"],
  9:  ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager"],
  10: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager"],
  11: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager", "villager"],
  12: ["werewolf", "werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "hunter", "villager", "villager", "villager", "villager"],
};

export function configFromPlayerCount(playerCount: number): GameConfig {
  const deck = PRESET_DECKS[playerCount];
  if (!deck) throw new GameRuleError(`不支持${playerCount}人局，请选择5到12人`);
  return { playerCount, roleDeck: deck };
}

export type GameState = {
  config: GameConfig;
  phase: GamePhase;
  nightNumber: number;
  dayNumber: number;
  roles: Record<string, Role>;
  confirmedRolePlayerIds: string[];
  actionId: string;
  // Night action state (cleared each night)
  wolfTargetId?: string;
  guardProtectedId?: string;
  guardLastProtectedId?: string;
  witchUsedAntidote: boolean;    // used antidote THIS night (for death resolution)
  witchAntidoteSpent: boolean;   // permanent: antidote bottle consumed
  witchPoisonSpent: boolean;     // permanent: poison bottle consumed
  witchPoisonTargetId?: string;
  seerTargetId?: string;
  seerResultConfirmed: boolean;
  hunterExecutionTargetId?: string;
  deaths: string[];              // died last night (persists through day for display)
  // Day state
  votes: Record<string, string>; // voterId → targetId (reused for day_pk)
  pkCandidateIds: string[];      // players tied in day_vote; targets for day_pk
  eliminatedTodayId?: string;
  noKillToday?: boolean;         // true when day_pk still tied
  // Cumulative
  deadPlayerIds: string[];
  winner?: "wolf" | "village";
};

export class GameRuleError extends Error {}

const NIGHT_ORDER: readonly Role[] = ["werewolf", "guard", "witch", "seer"];

function nightQueueFromConfig(config: GameConfig): Role[] {
  const inDeck = new Set(config.roleDeck);
  return NIGHT_ORDER.filter(r => inDeck.has(r));
}

function nextNightPhase(state: GameState, currentRole: Role): GamePhase {
  const queue = nightQueueFromConfig(state.config);
  const idx = queue.indexOf(currentRole);
  const next = queue[idx + 1];
  return next ? (`night_${next}` as GamePhase) : "night_complete";
}

function nextActionId(): string {
  return crypto.randomUUID();
}

function resolveNightDeaths(state: GameState): Set<string> {
  const deaths = new Set<string>();
  const guardBlocked =
    state.wolfTargetId &&
    state.wolfTargetId === state.guardProtectedId &&
    !state.witchUsedAntidote;
  if (state.wolfTargetId && !state.witchUsedAntidote && !guardBlocked) {
    deaths.add(state.wolfTargetId);
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

// Applies elimination of a single player and transitions to the correct next phase.
// Returns true if phase advanced to game_over.
function applyElimination(state: GameState, targetId: string): boolean {
  state.deadPlayerIds.push(targetId);
  state.eliminatedTodayId = targetId;
  delete state.noKillToday;

  if (state.roles[targetId] === "hunter") {
    state.phase = "day_hunter";
    state.actionId = nextActionId();
    return false;
  }

  const victory = checkVictory(state);
  if (victory) {
    state.phase = "game_over";
    state.winner = victory;
    state.actionId = nextActionId();
    return true;
  }
  state.phase = "day_result";
  state.actionId = nextActionId();
  return false;
}

export function dealRoles(
  playerIds: readonly string[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
  randomInt: (maxExclusive: number) => number = max => crypto.randomInt(max),
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
): GameState {
  return {
    config,
    phase: "role_reveal",
    nightNumber: 1,
    dayNumber: 0,
    roles: dealRoles(playerIds, config),
    confirmedRolePlayerIds: [],
    actionId: nextActionId(),
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

function assertKnownPlayer(state: GameState, playerId: string | undefined): asserts playerId is string {
  if (!playerId || !state.roles[playerId]) throw new GameRuleError("请选择有效玩家");
}

// ── Night phase functions ────────────────────────────────────────────────────

export function confirmRole(state: GameState, playerId: string, actionId?: string): boolean {
  if (state.confirmedRolePlayerIds.includes(playerId)) return false;
  assertAction(state, actionId, "role_reveal");
  assertKnownPlayer(state, playerId);

  state.confirmedRolePlayerIds.push(playerId);
  if (state.confirmedRolePlayerIds.length === state.config.playerCount) {
    // After all roles confirmed, host clicks to start the first night
    state.phase = "night_start";
    state.actionId = nextActionId();
    return true;
  }
  return false;
}

export function startNight(state: GameState): void {
  if (state.phase !== "night_start") {
    throw new GameRuleError("当前不能开始夜晚流程");
  }
  if (state.guardProtectedId) state.guardLastProtectedId = state.guardProtectedId;

  delete state.wolfTargetId;
  delete state.guardProtectedId;
  delete state.witchPoisonTargetId;
  delete state.seerTargetId;
  delete state.hunterExecutionTargetId;
  delete state.eliminatedTodayId;
  delete state.noKillToday;
  state.witchUsedAntidote = false;
  state.seerResultConfirmed = false;
  state.deaths = [];
  state.votes = {};
  state.pkCandidateIds = [];

  // Increment night number on subsequent nights (not the first)
  if (state.dayNumber > 0) state.nightNumber += 1;

  const firstNightRole = nightQueueFromConfig(state.config)[0];
  state.phase = firstNightRole ? (`night_${firstNightRole}` as GamePhase) : "night_complete";
  state.actionId = nextActionId();
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
  state.phase = nextNightPhase(state, "werewolf");
  state.actionId = nextActionId();
  return true;
}

export function submitGuardTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | undefined,
  actionId?: string,
): boolean {
  if (
    state.guardProtectedId === targetPlayerId &&
    state.roles[actorPlayerId] === "guard" &&
    state.phase !== "night_guard"
  ) return false;
  assertAction(state, actionId, "night_guard");
  assertRole(state, actorPlayerId, "guard");
  assertKnownPlayer(state, targetPlayerId);
  if (targetPlayerId === actorPlayerId) throw new GameRuleError("守卫不能保护自己");
  if (targetPlayerId === state.guardLastProtectedId) {
    throw new GameRuleError("不能连续两晚保护同一名玩家");
  }

  state.guardProtectedId = targetPlayerId;
  state.phase = nextNightPhase(state, "guard");
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

  if (requestedAntidote && requestedPoison) throw new GameRuleError("同一晚只能使用一瓶药");
  if (requestedAntidote && state.witchAntidoteSpent) throw new GameRuleError("解药已经使用过了");
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
  state.phase = nextNightPhase(state, "witch");
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
    (state.phase === "night_complete" || state.phase === "night_hunter" || state.phase === "game_over") &&
    state.seerResultConfirmed &&
    state.roles[actorPlayerId] === "seer"
  ) return false;
  assertAction(state, actionId, "night_seer");
  assertRole(state, actorPlayerId, "seer");
  if (!state.seerTargetId) throw new GameRuleError("请先选择查验目标");

  state.seerResultConfirmed = true;
  const deaths = resolveNightDeaths(state);
  state.deaths = [...deaths];

  for (const id of deaths) {
    if (!state.deadPlayerIds.includes(id)) state.deadPlayerIds.push(id);
  }

  const victory = checkVictory(state);
  if (victory) {
    state.phase = "game_over";
    state.winner = victory;
    state.actionId = nextActionId();
    return true;
  }

  const hunterPlayerId = Object.entries(state.roles).find(([, r]) => r === "hunter")?.[0];
  if (hunterPlayerId && deaths.has(hunterPlayerId)) {
    state.phase = "night_hunter";
  } else {
    state.phase = "night_complete";
  }
  state.actionId = nextActionId();
  return true;
}

export function submitHunterExecution(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | undefined,
  actionId?: string,
): boolean {
  const hunterPhases: GamePhase[] = ["night_hunter", "day_hunter"];
  if (
    state.hunterExecutionTargetId === targetPlayerId &&
    state.roles[actorPlayerId] === "hunter" &&
    !hunterPhases.includes(state.phase)
  ) return false;
  assertActionPhases(state, actionId, hunterPhases);
  assertRole(state, actorPlayerId, "hunter");
  if (!state.deadPlayerIds.includes(actorPlayerId)) throw new GameRuleError("猎人尚未死亡");
  assertKnownPlayer(state, targetPlayerId);
  if (state.deadPlayerIds.includes(targetPlayerId)) throw new GameRuleError("不能选择已死亡的玩家");

  state.hunterExecutionTargetId = targetPlayerId;
  if (!state.deadPlayerIds.includes(targetPlayerId)) state.deadPlayerIds.push(targetPlayerId);

  const victory = checkVictory(state);
  if (state.phase === "day_hunter") {
    // Day hunter — after execution, go to day_result or game_over
    if (victory) {
      state.phase = "game_over";
      state.winner = victory;
    } else {
      state.phase = "day_result";
    }
  } else {
    // Night hunter — after execution, go to night_complete or game_over
    if (victory) {
      state.phase = "game_over";
      state.winner = victory;
    } else {
      state.phase = "night_complete";
    }
  }
  state.actionId = nextActionId();
  return true;
}

// ── Day phase functions ──────────────────────────────────────────────────────

// Called by server immediately after emitting game:night-complete.
// Auto-transitions night_complete → day_vote (no host click needed).
export function startDayVote(state: GameState): void {
  if (state.phase !== "night_complete") {
    throw new GameRuleError("只能在夜间结束后开始白天投票");
  }
  state.dayNumber += 1;
  state.votes = {};
  state.pkCandidateIds = [];
  delete state.eliminatedTodayId;
  delete state.noKillToday;
  state.phase = "day_vote";
  state.actionId = nextActionId();
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
  if (voterId === targetId) throw new GameRuleError("不能投票给自己");
  // In PK phase, only pkCandidateIds are valid targets
  if (state.phase === "day_pk" && !state.pkCandidateIds.includes(targetId)) {
    throw new GameRuleError("请从平票玩家中选择放逐目标");
  }
  if (state.votes[voterId] === targetId) return false;
  state.votes[voterId] = targetId;
  return true;
}

export function allAliveVoted(state: GameState): boolean {
  const aliveIds = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
  return aliveIds.length > 0 && aliveIds.every(id => id in state.votes);
}

// Closes voting and resolves outcome. Works for both day_vote and day_pk.
// Returns the eliminated player id, "pk" (tie on first vote → entering pk), or "no_kill" (pk still tied).
export function closeDayVote(state: GameState): "pk" | "no_kill" | string {
  if (state.phase !== "day_vote" && state.phase !== "day_pk") {
    throw new GameRuleError("当前不在投票阶段");
  }
  const isPk = state.phase === "day_pk";

  // Build tally
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(state.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  if (Object.keys(tally).length === 0) {
    // No votes cast at all
    if (isPk) {
      state.noKillToday = true;
      delete state.eliminatedTodayId;
      state.phase = "day_result";
      state.actionId = nextActionId();
      return "no_kill";
    }
    // First round with no votes — go to PK with all alive as candidates? Treat as no-kill.
    state.noKillToday = true;
    state.phase = "day_result";
    state.actionId = nextActionId();
    return "no_kill";
  }

  const maxVotes = Math.max(...Object.values(tally));
  const topCandidates = Object.keys(tally).filter(id => tally[id] === maxVotes);

  if (topCandidates.length === 1) {
    // Clear winner — eliminate
    applyElimination(state, topCandidates[0]!);
    return topCandidates[0]!;
  }

  // Tie
  if (isPk) {
    // PK also tied — no kill
    state.noKillToday = true;
    delete state.eliminatedTodayId;
    state.phase = "day_result";
    state.actionId = nextActionId();
    return "no_kill";
  }

  // First vote tied — enter PK
  state.pkCandidateIds = topCandidates;
  state.votes = {};
  state.phase = "day_pk";
  state.actionId = nextActionId();
  return "pk";
}

// Host clicks "宣布结果并准备夜晚" on day_result screen.
export function beginNightStart(state: GameState): void {
  if (state.phase !== "day_result") {
    throw new GameRuleError("当前不能进入夜晚准备阶段");
  }
  state.phase = "night_start";
  state.actionId = nextActionId();
}

export function playerIdForRole(state: GameState, role: Role): string {
  const entry = Object.entries(state.roles).find(([, assignedRole]) => assignedRole === role);
  if (!entry) throw new GameRuleError(`本局缺少角色：${role}`);
  return entry[0];
}
