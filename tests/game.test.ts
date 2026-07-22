import { describe, expect, it } from "vitest";
import {
  allAliveVoted,
  beginNightStart,
  checkVictory,
  closeDayVote,
  configFromPlayerCount,
  confirmRole,
  confirmSeerResult,
  dealRoles,
  playerIdForRole,
  startDayVote,
  startGame,
  startNight,
  submitGuardTarget,
  submitHunterExecution,
  submitSeerTarget,
  submitVote,
  submitWitchAction,
  submitWolfTarget,
  type GameConfig,
} from "../src/domain/game.js";

const PLAYERS = ["p1", "p2", "p3", "p4", "p5"];

function beginNight() {
  const state = startGame(PLAYERS);
  for (const playerId of PLAYERS) confirmRole(state, playerId, state.actionId);
  // After all roles confirmed, phase is night_start; call startNight to begin
  startNight(state);
  return state;
}

describe("five-player game", () => {
  it("deals exactly the configured private roles", () => {
    const roles = Object.values(dealRoles(PLAYERS, undefined, () => 0));
    expect(roles).toHaveLength(5);
    expect(roles.filter(role => role === "werewolf")).toHaveLength(1);
    expect(roles.filter(role => role === "seer")).toHaveLength(1);
    expect(roles.filter(role => role === "witch")).toHaveLength(1);
    expect(roles.filter(role => role === "villager")).toHaveLength(2);
  });

  it("waits for every role confirmation before waking the werewolf", () => {
    const state = startGame(PLAYERS);
    const revealActionId = state.actionId;
    for (const playerId of PLAYERS.slice(0, 4)) confirmRole(state, playerId, revealActionId);
    expect(state.phase).toBe("role_reveal");

    expect(confirmRole(state, PLAYERS[4]!, revealActionId)).toBe(true);
    expect(state.phase).toBe("night_start");
    expect(state.actionId).not.toBe(revealActionId);
    startNight(state);
    expect(state.phase).toBe("night_werewolf");
  });

  it("runs wolf, witch, and seer in order and settles a saved night", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = PLAYERS.find(id => id !== wolf && id !== witch)!;

    submitWolfTarget(state, wolf, victim, state.actionId);
    expect(state.phase).toBe("night_witch");
    submitWitchAction(state, witch, { useAntidote: true }, state.actionId);
    expect(state.phase).toBe("night_seer");
    expect(submitSeerTarget(state, seer, wolf, state.actionId)).toBe("werewolf");
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("night_complete");
    expect(state.deaths).toEqual([]);
  });

  it("settles both wolf and poison deaths when the antidote is not used", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const candidates = PLAYERS.filter(id => id !== wolf && id !== witch);

    submitWolfTarget(state, wolf, candidates[0], state.actionId);
    submitWitchAction(state, witch, { poisonTargetId: candidates[1]! }, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(new Set(state.deaths)).toEqual(new Set([candidates[0], candidates[1]]));
  });

  it("allows the werewolf to target itself", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");

    submitWolfTarget(state, wolf, wolf, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.deadPlayerIds).toContain(wolf);
    expect(state.winner).toBe("village");
  });

  it("allows the werewolf to leave the night without a kill", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");

    submitWolfTarget(state, wolf, null, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.wolfTargetId).toBeUndefined();
    expect(state.deaths).toEqual([]);
  });

  it("does not allow the witch to spend antidote after an empty wolf kill", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");

    submitWolfTarget(state, wolf, null, state.actionId);

    expect(() =>
      submitWitchAction(state, witch, { useAntidote: true }, state.actionId),
    ).toThrow("今晚没有狼人击杀目标");
    expect(state.witchAntidoteSpent).toBe(false);
  });

  it("skips witch action after both potions have been spent", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const victim = PLAYERS.find(id => id !== wolf && id !== witch)!;
    state.witchAntidoteSpent = true;
    state.witchPoisonSpent = true;

    submitWolfTarget(state, wolf, victim, state.actionId);

    expect(state.phase).toBe("night_seer");
  });

  it("skips witch action when only antidote remains after an empty wolf kill", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    state.witchPoisonSpent = true;

    submitWolfTarget(state, wolf, null, state.actionId);

    expect(state.phase).toBe("night_seer");
  });

  it("rejects invalid actors, stale actions, and using both potions", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const victim = PLAYERS.find(id => id !== wolf)!;
    const differentVictim = PLAYERS.find(id => id !== wolf && id !== victim)!;
    const staleActionId = state.actionId;

    expect(() => submitWolfTarget(state, witch, victim, state.actionId)).toThrow("当前不是你的行动阶段");
    submitWolfTarget(state, wolf, victim, state.actionId);
    expect(() => submitWolfTarget(state, wolf, differentVictim, staleActionId)).toThrow("行动已失效");
    expect(() =>
      submitWitchAction(
        state,
        witch,
        { useAntidote: true, poisonTargetId: victim },
        state.actionId,
      ),
    ).toThrow("同一晚只能使用一瓶药");
  });

  it("startGame uses default config when none provided", () => {
    const state = startGame(PLAYERS);
    expect(state.config.playerCount).toBe(5);
    expect(state.config.roleDeck).toEqual(["werewolf", "seer", "witch", "villager", "villager"]);
  });

  it("treats an identical repeated submission as a successful no-op", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = PLAYERS.find(id => id !== wolf)!;

    const wolfActionId = state.actionId;
    submitWolfTarget(state, wolf, victim, wolfActionId);
    expect(() => submitWolfTarget(state, wolf, victim, wolfActionId)).not.toThrow();

    const witchActionId = state.actionId;
    submitWitchAction(state, witch, { useAntidote: true }, witchActionId);
    expect(() =>
      submitWitchAction(state, witch, { useAntidote: true }, witchActionId),
    ).not.toThrow();

    const seerActionId = state.actionId;
    submitSeerTarget(state, seer, wolf, seerActionId);
    expect(submitSeerTarget(state, seer, wolf, seerActionId)).toBe("werewolf");
    confirmSeerResult(state, seer, seerActionId);
    expect(() => confirmSeerResult(state, seer, seerActionId)).not.toThrow();
  });

  it("skips dead night roles and still settles the night", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = PLAYERS.find(
      playerId => ![wolf, witch, seer].includes(playerId),
    )!;
    state.deadPlayerIds.push(seer);

    submitWolfTarget(state, wolf, victim, state.actionId);
    expect(state.phase).toBe("night_witch");
    submitWitchAction(state, witch, {}, state.actionId);

    expect(state.phase).toBe("night_complete");
    expect(state.deadPlayerIds).toContain(victim);
    expect(state.deaths).toEqual([victim]);
  });

  it("rejects a night action submitted by a dead role", () => {
    const state = beginNight();
    const seer = playerIdForRole(state, "seer");
    const wolf = playerIdForRole(state, "werewolf");
    state.deadPlayerIds.push(seer);
    state.phase = "night_seer";
    state.actionId = "dead-seer-action";

    expect(() => submitSeerTarget(state, seer, wolf, state.actionId)).toThrow(
      "已出局的玩家不能执行夜间行动",
    );
  });
});

describe("custom GameConfig", () => {
  const THREE_PLAYERS = ["p1", "p2", "p3"];
  const config: GameConfig = {
    playerCount: 3,
    roleDeck: ["werewolf", "seer", "villager"],
  };

  it("skips witch phase when witch is absent from the deck", () => {
    const state = startGame(THREE_PLAYERS, config);
    for (const playerId of THREE_PLAYERS) confirmRole(state, playerId, state.actionId);
    startNight(state);

    expect(state.phase).toBe("night_werewolf");

    const wolf = playerIdForRole(state, "werewolf");
    const seer = playerIdForRole(state, "seer");
    const victim = THREE_PLAYERS.find(id => id !== wolf && id !== seer)!;

    submitWolfTarget(state, wolf, victim, state.actionId);
    expect(state.phase).toBe("night_seer");

    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);
    // 3-player config: wolf kills victim → 1 wolf vs 1 seer → wolf wins
    expect(["night_complete", "game_over"]).toContain(state.phase);
    expect(state.deadPlayerIds).toContain(victim);
  });
});

// Players for 8-player (guard) and 10-player (guard + hunter) tests
const P8 = ["p1","p2","p3","p4","p5","p6","p7","p8"];
const P10 = ["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10"];

function beginNightWith(players: string[], config: GameConfig) {
  const state = startGame(players, config);
  for (const id of players) confirmRole(state, id, state.actionId);
  startNight(state);
  return state;
}

function nonWolves(state: ReturnType<typeof startGame>, ...exclude: string[]) {
  const excludeSet = new Set(exclude);
  return Object.entries(state.roles)
    .filter(([id, r]) => r !== "werewolf" && !excludeSet.has(id))
    .map(([id]) => id);
}

describe("guard role", () => {
  const config8 = configFromPlayerCount(8);

  it("runs guard before wolf and witch", () => {
    const state = beginNightWith(P8, config8);
    expect(state.phase).toBe("night_guard");
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const target = nonWolves(state, guard)[0]!;
    submitGuardTarget(state, guard, target, state.actionId);
    expect(state.phase).toBe("night_werewolf");
    submitWolfTarget(state, wolf, target, state.actionId);
    expect(state.phase).toBe("night_witch");
  });

  it("guard protection blocks the wolf kill", () => {
    const state = beginNightWith(P8, config8);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = nonWolves(state, guard, witch, seer)[0]!;

    submitGuardTarget(state, guard, victim, state.actionId);
    submitWolfTarget(state, wolf, victim, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.deaths).not.toContain(victim);
  });

  it("guard does not block kill when protecting a different player", () => {
    const state = beginNightWith(P8, config8);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const candidates = nonWolves(state, guard, witch, seer);
    const victim = candidates[0]!;
    const other = candidates[1]!;

    submitGuardTarget(state, guard, other, state.actionId);
    submitWolfTarget(state, wolf, victim, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.deaths).toContain(victim);
  });

  it("same guard and antidote protection still kills the wolf target", () => {
    const state = beginNightWith(P8, config8);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = nonWolves(state, guard, witch, seer)[0]!;

    submitGuardTarget(state, guard, victim, state.actionId);
    submitWolfTarget(state, wolf, victim, state.actionId);
    submitWitchAction(state, witch, { useAntidote: true }, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.deaths).toContain(victim);
  });

  it("guard can protect self", () => {
    const state = beginNightWith(P8, config8);
    const guard = playerIdForRole(state, "guard");
    expect(submitGuardTarget(state, guard, guard, state.actionId)).toBe(true);
    expect(state.guardProtectedId).toBe(guard);
    expect(state.phase).toBe("night_werewolf");
  });

  it("guard can leave the night unprotected", () => {
    const state = beginNightWith(P8, config8);
    const guard = playerIdForRole(state, "guard");
    expect(submitGuardTarget(state, guard, null, state.actionId)).toBe(true);
    expect(state.guardProtectedId).toBeUndefined();
    expect(state.phase).toBe("night_werewolf");
  });

  it("guard cannot protect same player two nights in a row", () => {
    const state = beginNightWith(P8, config8);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const target = nonWolves(state, guard, witch, seer)[0]!;

    // First night: guard protects target
    submitGuardTarget(state, guard, target, state.actionId);
    submitWolfTarget(state, wolf, target, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    // Simulate second night by resetting phase manually (tests domain logic only)
    state.phase = "night_guard";
    state.actionId = "test-action-2";
    if (state.guardProtectedId) state.guardLastProtectedId = state.guardProtectedId;
    expect(() => submitGuardTarget(state, guard, target, "test-action-2")).toThrow("不能连续两晚保护同一名玩家");
  });
});

describe("hunter role", () => {
  const config10 = configFromPlayerCount(10);

  it("announces a wolf-killed hunter before the hunter acts during the day", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");

    submitGuardTarget(state, guard, wolf, state.actionId); // guard protects wolf, not hunter
    submitWolfTarget(state, wolf, hunter, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("day_hunter");
    expect(state.hunterTrigger).toBe("night");
    expect(state.deaths).toContain(hunter);
  });

  it("lets a night-killed hunter shoot before a parity victory is decided", () => {
    const state = beginNightWith(P10, config10);
    const hunter = playerIdForRole(state, "hunter");
    const seer = playerIdForRole(state, "seer");
    const wolf = playerIdForRole(state, "werewolf");
    const villagers = Object.keys(state.roles).filter(
      playerId => state.roles[playerId] === "villager",
    );
    state.deadPlayerIds.push(...villagers);
    state.phase = "night_seer";
    state.wolfTargetId = hunter;
    state.actionId = "hunter-parity";

    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("day_hunter");
    expect(state.hunterTrigger).toBe("night");
    expect(state.winner).toBeUndefined();
  });

  it("hunter execution adds target to deaths and advances to night_complete", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");
    const wolves = new Set(Object.entries(state.roles).filter(([,r]) => r === "werewolf").map(([id]) => id));
    const bystander = P10.find(id => !wolves.has(id) && ![guard, witch, seer, hunter].includes(id))!;

    submitGuardTarget(state, guard, wolf, state.actionId);
    submitWolfTarget(state, wolf, hunter, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    submitHunterExecution(state, hunter, bystander, state.actionId);

    expect(["night_complete", "game_over"]).toContain(state.phase);
    expect(state.deadPlayerIds).toContain(bystander);
  });

  it("hunter can decline to shoot", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");

    submitGuardTarget(state, guard, null, state.actionId);
    submitWolfTarget(state, wolf, hunter, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("day_hunter");
    expect(submitHunterExecution(state, hunter, null, state.actionId)).toBe(true);
    expect(state.hunterExecutionTargetId).toBeUndefined();
    expect(["night_complete", "game_over"]).toContain(state.phase);
  });

  it("returns to the day result after a voted-out hunter acts", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");
    const victim = P10.find(id => ![wolf, guard, witch, seer, hunter].includes(id))!;

    submitGuardTarget(state, guard, wolf, state.actionId);
    submitWolfTarget(state, wolf, victim, state.actionId);
    submitWitchAction(state, witch, { useAntidote: true }, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);
    startDayVote(state);
    voteOut(state, hunter);

    expect(state.phase).toBe("day_hunter");
    expect(state.hunterTrigger).toBe("day");
    submitHunterExecution(state, hunter, null, state.actionId);
    expect(state.phase).toBe("day_result");
  });

  it("does not let a poisoned hunter shoot", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");
    const wolfVictim = P10.find(id => ![wolf, guard, witch, seer, hunter].includes(id))!;

    submitGuardTarget(state, guard, null, state.actionId);
    submitWolfTarget(state, wolf, wolfVictim, state.actionId);
    submitWitchAction(state, witch, { poisonTargetId: hunter }, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.deadPlayerIds).toContain(hunter);
    expect(state.phase).not.toBe("day_hunter");
  });

  it("hunter cannot target a dead player", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");
    const wolves = new Set(Object.entries(state.roles).filter(([,r]) => r === "werewolf").map(([id]) => id));
    const victim = P10.find(id => !wolves.has(id) && ![guard, witch, seer, hunter].includes(id))!;

    // Wolf kills both hunter and victim via poison
    submitGuardTarget(state, guard, wolf, state.actionId);
    submitWolfTarget(state, wolf, hunter, state.actionId);
    submitWitchAction(state, witch, { poisonTargetId: victim }, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("day_hunter");
    expect(() => submitHunterExecution(state, hunter, victim, state.actionId)).toThrow("不能选择已死亡的玩家");
  });

  it("skips hunter action when hunter is not killed", () => {
    const state = beginNightWith(P10, config10);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const hunter = playerIdForRole(state, "hunter");
    const wolves = new Set(Object.entries(state.roles).filter(([,r]) => r === "werewolf").map(([id]) => id));
    const victim = P10.find(id => !wolves.has(id) && ![guard, witch, seer, hunter].includes(id))!;

    submitGuardTarget(state, guard, wolf, state.actionId);
    submitWolfTarget(state, wolf, victim, state.actionId); // wolf kills non-hunter
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("night_complete");
  });
});

describe("auto config presets", () => {
  it("5-player: 1 wolf, no guard, no hunter", () => {
    const config = configFromPlayerCount(5);
    const deck = [...config.roleDeck];
    expect(deck.filter(r => r === "werewolf")).toHaveLength(1);
    expect(deck.includes("guard")).toBe(false);
    expect(deck.includes("hunter")).toBe(false);
  });

  it("8-player: has guard, no hunter", () => {
    const config = configFromPlayerCount(8);
    expect(config.playerCount).toBe(8);
    expect(config.roleDeck.includes("guard")).toBe(true);
    expect(config.roleDeck.includes("hunter")).toBe(false);
  });

  it("10-player: has guard and hunter", () => {
    const config = configFromPlayerCount(10);
    expect(config.roleDeck.includes("guard")).toBe(true);
    expect(config.roleDeck.includes("hunter")).toBe(true);
  });

  it("12-player: 4 wolves", () => {
    const config = configFromPlayerCount(12);
    expect([...config.roleDeck].filter(r => r === "werewolf")).toHaveLength(4);
  });

  it("throws for unsupported player count", () => {
    expect(() => configFromPlayerCount(4)).toThrow();
    expect(() => configFromPlayerCount(13)).toThrow();
  });
});

// Helper: run through a full 5-player night and reach night_complete, then start day vote
function completeFivePlayerNight(players = PLAYERS) {
  const state = startGame(players);
  for (const id of players) confirmRole(state, id, state.actionId);
  startNight(state);
  const wolf = playerIdForRole(state, "werewolf");
  const witch = playerIdForRole(state, "witch");
  const seer = playerIdForRole(state, "seer");
  const victim = players.find(id => id !== wolf && id !== witch && id !== seer)!;
  submitWolfTarget(state, wolf, victim, state.actionId);
  submitWitchAction(state, witch, {}, state.actionId);
  submitSeerTarget(state, seer, wolf, state.actionId);
  confirmSeerResult(state, seer, state.actionId);
  if (state.phase === "night_complete") startDayVote(state);
  return { state, wolf, witch, seer, victim };
}

// Helper: vote everyone against a target and close, expecting clear win
function voteOut(state: ReturnType<typeof startGame>, targetId: string): void {
  const voteId = state.actionId;
  for (const voter of Object.keys(state.roles)) {
    if (!state.deadPlayerIds.includes(voter) && voter !== targetId) {
      submitVote(state, voter, targetId, voteId);
    }
  }
  closeDayVote(state);
}

describe("day phase", () => {
  it("startDayVote transitions from night_complete to day_vote", () => {
    const { state } = completeFivePlayerNight();
    // completeFivePlayerNight already calls startDayVote if night_complete
    expect(state.phase).toBe("day_vote");
    expect(state.dayNumber).toBe(1);
  });

  it("startDayVote rejects if not night_complete", () => {
    const state = startGame(PLAYERS);
    expect(() => startDayVote(state)).toThrow();
  });

  it("submitVote records a vote and is idempotent", () => {
    const { state } = completeFivePlayerNight();
    const aliveVoter = PLAYERS.find(id => !state.deadPlayerIds.includes(id))!;
    const aliveTarget = PLAYERS.find(id => id !== aliveVoter && !state.deadPlayerIds.includes(id))!;
    const voteId = state.actionId;
    expect(submitVote(state, aliveVoter, aliveTarget, voteId)).toBe(true);
    expect(state.votes[aliveVoter]).toBe(aliveTarget);
    expect(submitVote(state, aliveVoter, aliveTarget, voteId)).toBe(false);
  });

  it("dead players cannot vote", () => {
    const { state, victim } = completeFivePlayerNight();
    const anyAlive = PLAYERS.find(id => id !== victim && !state.deadPlayerIds.includes(id))!;
    expect(() => submitVote(state, victim, anyAlive, state.actionId)).toThrow("已出局");
  });

  it("allAliveVoted returns true when everyone voted", () => {
    const { state, wolf } = completeFivePlayerNight();
    const voters = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
    const voteId = state.actionId;
    for (const voter of voters) {
      if (voter !== wolf) submitVote(state, voter, wolf, voteId);
      else submitVote(state, voter, voters.find(id => id !== voter)!, voteId);
    }
    expect(allAliveVoted(state)).toBe(true);
  });

  it("closeDayVote eliminates clear winner and goes to day_result", () => {
    const { state, wolf } = completeFivePlayerNight();
    voteOut(state, wolf);
    expect(state.deadPlayerIds).toContain(wolf);
    // Eliminating the only wolf → village wins
    expect(state.phase).toBe("game_over");
    expect(state.winner).toBe("village");
  });

  it("closeDayVote eliminates non-wolf and goes to day_result", () => {
    const { state, witch } = completeFivePlayerNight();
    voteOut(state, witch);
    expect(state.deadPlayerIds).toContain(witch);
    expect(state.phase).toBe("day_result");
  });

  it("closeDayVote on tie enters day_pk with candidate ids", () => {
    const { state } = completeFivePlayerNight();
    const alive = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
    const voteId = state.actionId;
    // Split vote: half vote for alive[0], half vote for alive[1]
    for (let i = 0; i < alive.length; i++) {
      const voter = alive[i]!;
      const target = i % 2 === 0 ? alive[1]! : alive[0]!;
      if (voter !== target) submitVote(state, voter, target, voteId);
    }
    closeDayVote(state);
    expect(state.phase).toBe("day_pk");
    expect(state.pkCandidateIds.length).toBeGreaterThan(0);
  });

  it("day_pk vote with clear winner eliminates and goes to day_result", () => {
    const { state } = completeFivePlayerNight();
    const alive = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
    const voteId = state.actionId;
    // Create a tie between alive[0] and alive[1]
    for (let i = 0; i < alive.length; i++) {
      const voter = alive[i]!;
      const target = i % 2 === 0 ? alive[1]! : alive[0]!;
      if (voter !== target) submitVote(state, voter, target, voteId);
    }
    closeDayVote(state); // enters day_pk
    // Only non-PK alive players vote against pkCandidateIds[0]
    const pkTarget = state.pkCandidateIds[0]!;
    const pkVoteId = state.actionId;
    const eligibleVoters = Object.keys(state.roles).filter(
      id => !state.deadPlayerIds.includes(id) && !state.pkCandidateIds.includes(id),
    );
    for (const voter of eligibleVoters) {
      submitVote(state, voter, pkTarget, pkVoteId);
    }
    expect(allAliveVoted(state)).toBe(true);
    closeDayVote(state);
    expect(state.deadPlayerIds).toContain(pkTarget);
    expect(["day_result", "game_over"]).toContain(state.phase);
  });

  it("day_pk excludes PK candidates from voting", () => {
    const { state } = completeFivePlayerNight();
    const alive = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
    const [candidateA, candidateB] = alive;
    state.phase = "day_pk";
    state.pkCandidateIds = [candidateA!, candidateB!];
    state.votes = {};
    state.actionId = "pk-candidates-cannot-vote";

    expect(() => submitVote(state, candidateA!, candidateB!, state.actionId)).toThrow(
      "PK玩家不能参与PK投票",
    );

    const eligibleVoters = alive.filter(playerId => !state.pkCandidateIds.includes(playerId));
    for (const voter of eligibleVoters) {
      submitVote(state, voter, candidateA!, state.actionId);
    }
    expect(allAliveVoted(state)).toBe(true);
  });

  it("day_pk still tied → no kill, day_result", () => {
    const { state } = completeFivePlayerNight();
    const alive = Object.keys(state.roles).filter(id => !state.deadPlayerIds.includes(id));
    // Force a tie in first vote
    for (let i = 0; i < alive.length; i++) {
      const voter = alive[i]!;
      const target = i % 2 === 0 ? alive[1]! : alive[0]!;
      if (voter !== target) submitVote(state, voter, target, state.actionId);
    }
    closeDayVote(state); // day_pk
    // Tie again in PK: the two eligible non-PK voters split their votes
    const [cand0, cand1] = state.pkCandidateIds;
    const pkVoteId = state.actionId;
    const pkVoters = Object.keys(state.roles).filter(
      id => !state.deadPlayerIds.includes(id) && !state.pkCandidateIds.includes(id),
    );
    expect(pkVoters).toHaveLength(2);
    submitVote(state, pkVoters[0]!, cand0!, pkVoteId);
    submitVote(state, pkVoters[1]!, cand1!, pkVoteId);
    expect(allAliveVoted(state)).toBe(true);
    closeDayVote(state);
    expect(state.noKillToday).toBe(true);
    expect(state.phase).toBe("day_result");
    expect(state.eliminatedTodayId).toBeUndefined();
  });

  it("wolf victory triggers during day voting", () => {
    const state = startGame(PLAYERS);
    for (const id of PLAYERS) confirmRole(state, id, state.actionId);
    startNight(state);
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const villagers = PLAYERS.filter(id => state.roles[id] === "villager");

    // Night 1: wolf kills witch
    submitWolfTarget(state, wolf, witch, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);
    if (state.phase === "night_complete") startDayVote(state);

    // Day 1: vote out a villager (non-wolf)
    voteOut(state, villagers[0]!);
    if (state.phase === "day_result") {
      beginNightStart(state);
      startNight(state);
    }
    // Night 2: wolf kills last villager → wolf(1) >= others(seer=1) → wolf wins
    const seer2 = playerIdForRole(state, "seer");
    submitWolfTarget(state, wolf, villagers[1]!, state.actionId);
    submitWitchAction(state, playerIdForRole(state, "witch"), {}, state.actionId);
    submitSeerTarget(state, seer2, wolf, state.actionId);
    confirmSeerResult(state, seer2, state.actionId);
    if (state.phase === "night_complete") startDayVote(state);
    expect(["game_over", "day_vote"]).toContain(state.phase);
  });
});

describe("game loop", () => {
  it("beginNightStart + startNight clears state and advances to first night role", () => {
    const { state, witch } = completeFivePlayerNight();
    voteOut(state, witch);
    expect(state.phase).toBe("day_result");
    beginNightStart(state);
    expect(state.phase).toBe("night_start");
    startNight(state);
    expect(state.phase).toBe("night_werewolf");
    expect(state.nightNumber).toBe(2);
    expect(state.deaths).toEqual([]);
    expect(state.votes).toEqual({});
    expect(state.wolfTargetId).toBeUndefined();
    expect(state.seerTargetId).toBeUndefined();
  });

  it("guard consecutive-night protection rule persists across nights", () => {
    const config8 = configFromPlayerCount(8);
    const state = beginNightWith(P8, config8);
    const wolf = playerIdForRole(state, "werewolf");
    const guard = playerIdForRole(state, "guard");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const target = nonWolves(state, guard, witch, seer)[0]!;

    submitGuardTarget(state, guard, target, state.actionId);
    submitWolfTarget(state, wolf, target, state.actionId);
    submitWitchAction(state, witch, {}, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);
    if (state.phase === "night_complete") startDayVote(state);

    // Day: eliminate a villager to avoid game_over
    const villager = nonWolves(state, guard, witch, seer, target)[0]!;
    voteOut(state, villager);
    if (state.phase === "day_result") {
      beginNightStart(state);
      startNight(state);
    }
    expect(state.guardLastProtectedId).toBe(target);
    // Night 2: guard cannot protect same target again
    expect(() => submitGuardTarget(state, guard, target, state.actionId)).toThrow("不能连续两晚");
  });
});
