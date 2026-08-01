import { describe, expect, it } from "vitest";
import { createDeck, type CardId, type Rank } from "../src/games/doudizhu/cards.js";
import { createDouDizhuEngine } from "../src/games/doudizhu/engine.js";
import type { DouDizhuCommand, DouDizhuGameState } from "../src/games/doudizhu/state.js";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return (maxExclusive: number) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value % maxExclusive;
  };
}

function fixture(seed = 7) {
  let actionNumber = 0;
  const engine = createDouDizhuEngine({
    randomInt: seededRandom(seed),
    nextActionId: () => `action-${++actionNumber}`,
  });
  const config = engine.createConfig(3);
  const state = engine.createInitialState({
    playerIds: ["one", "two", "three"],
    config,
  });
  return { engine, state };
}

function envelope(state: DouDizhuGameState, actorPlayerId: string, requestId: string) {
  return {
    actorPlayerId,
    requestId,
    actionId: state.actionId,
    stateRevision: state.revision,
  };
}

function bidThree(
  engine: ReturnType<typeof createDouDizhuEngine>,
  state: DouDizhuGameState,
  requestId = "bid-three",
) {
  const actorPlayerId = state.currentPlayerId;
  return engine.handleCommand(state, {
    type: "bid",
    bid: 3,
    ...envelope(state, actorPlayerId, requestId),
  }).state;
}

function cardIds(rank: Rank, count: number): CardId[] {
  return createDeck().filter(card => card.rank === rank).slice(0, count).map(card => card.id);
}

describe("doudizhu engine initialization and views", () => {
  it("creates a deterministic three-player bidding state", () => {
    const first = fixture(99);
    const second = fixture(99);
    expect(first.state).toMatchObject({
      rulesVersion: "doudizhu-classic-v1",
      phase: "bidding",
      revision: 0,
      consecutivePasses: 0,
      bombCount: 0,
    });
    expect(Object.values(first.state.hands).map(hand => hand.length)).toEqual([17, 17, 17]);
    expect(first.state.bottomCards).toHaveLength(3);
    expect(second.state.hands).toEqual(first.state.hands);
    expect(first.engine.actingPlayerIds(first.state)).toEqual([first.state.currentPlayerId]);
  });

  it("keeps bottom cards and other hands out of pre-landlord views", () => {
    const { engine, state } = fixture();
    const viewerId = state.playerIds[0];
    const otherPlayerId = state.playerIds[1];
    const context = { players: [], viewerIsHost: true };
    const publicView = engine.projectPublicView(state, context) as Record<string, unknown>;
    const playerView = engine.projectPlayerView(state, viewerId, context) as Record<string, unknown>;
    expect(publicView).not.toHaveProperty("hands");
    expect(publicView.bottomCards).toEqual([]);
    expect(playerView.hand).toEqual(state.hands[viewerId]);
    expect(JSON.stringify(playerView)).not.toContain(state.hands[otherPlayerId]![0]!);
  });
});

describe("doudizhu engine bidding", () => {
  it("selects the landlord, reveals bottom cards, and gives the landlord 20 cards", () => {
    const { engine, state } = fixture();
    const landlordPlayerId = state.currentPlayerId;
    const next = bidThree(engine, state);
    expect(next).toMatchObject({
      phase: "playing",
      revision: 1,
      landlordPlayerId,
      currentPlayerId: landlordPlayerId,
      trickLeaderPlayerId: landlordPlayerId,
    });
    expect(next.hands[landlordPlayerId]).toHaveLength(20);
    expect((engine.projectPublicView(next, { players: [], viewerIsHost: false }) as {
      bottomCards: CardId[];
    }).bottomCards).toEqual(next.bottomCards);
  });

  it("redeals after three passes and rotates the first bidder", () => {
    const { engine, state } = fixture();
    const firstBidderIndex = state.bidding.firstBidderIndex;
    const originalDeck = JSON.stringify(state.hands);
    for (let index = 0; index < 3; index += 1) {
      const actorPlayerId = state.currentPlayerId;
      const transition = engine.handleCommand(state, {
        type: "bid",
        bid: 0,
        ...envelope(state, actorPlayerId, `pass-bid-${index}`),
      });
      Object.assign(state, transition.state);
    }
    const expectedIndex = (firstBidderIndex + 1) % 3;
    expect(state).toMatchObject({
      phase: "bidding",
      revision: 3,
      currentPlayerId: state.playerIds[expectedIndex],
    });
    expect(JSON.stringify(state.hands)).not.toBe(originalDeck);
    expect(Object.values(state.hands).map(hand => hand.length)).toEqual([17, 17, 17]);
  });

  it("rejects stale commands without changing state", () => {
    const { engine, state } = fixture();
    const before = JSON.stringify(state);
    expect(() => engine.handleCommand(state, {
      type: "bid",
      bid: 1,
      ...envelope(state, state.currentPlayerId, "stale"),
      stateRevision: state.revision + 1,
    })).toThrow("游戏状态已经更新");
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("doudizhu engine play loop", () => {
  it("removes played cards and advances to the next player", () => {
    const { engine, state } = fixture();
    bidThree(engine, state);
    const actorPlayerId = state.currentPlayerId;
    const cardId = state.hands[actorPlayerId]![0]!;
    const beforeCount = state.hands[actorPlayerId]!.length;
    const transition = engine.handleCommand(state, {
      type: "play_cards",
      cardIds: [cardId],
      ...envelope(state, actorPlayerId, "play-one"),
    });
    expect(transition.changed).toBe(true);
    expect(state.hands[actorPlayerId]).toHaveLength(beforeCount - 1);
    expect(state.currentCombination).toMatchObject({
      playerId: actorPlayerId,
      cardIds: [cardId],
      combination: { type: "single" },
    });
    expect(state.currentPlayerId).not.toBe(actorPlayerId);
  });

  it("rejects forged cards and non-beating combinations without mutation", () => {
    const { engine, state } = fixture();
    bidThree(engine, state);
    const landlord = state.currentPlayerId;
    const challenger = state.playerIds[(state.playerIds.indexOf(landlord) + 1) % 3]!;
    state.hands[landlord] = [...cardIds(4, 1), ...cardIds(9, 1)];
    state.hands[challenger] = cardIds(3, 1);
    engine.handleCommand(state, {
      type: "play_cards",
      cardIds: cardIds(4, 1),
      ...envelope(state, landlord, "lead-four"),
    });

    const beforeForged = JSON.stringify(state);
    expect(() => engine.handleCommand(state, {
      type: "play_cards",
      cardIds: cardIds(9, 1),
      ...envelope(state, challenger, "forged"),
    })).toThrow("只能打出自己手牌中的牌");
    expect(JSON.stringify(state)).toBe(beforeForged);

    expect(() => engine.handleCommand(state, {
      type: "play_cards",
      cardIds: cardIds(3, 1),
      ...envelope(state, challenger, "too-small"),
    })).toThrow("无法压过当前牌型");
    expect(JSON.stringify(state)).toBe(beforeForged);
  });

  it("resets free-play rights after two consecutive passes", () => {
    const { engine, state } = fixture();
    bidThree(engine, state);
    const leader = state.currentPlayerId;
    const leadCard = state.hands[leader]![0]!;
    engine.handleCommand(state, {
      type: "play_cards",
      cardIds: [leadCard],
      ...envelope(state, leader, "lead"),
    });
    for (const requestId of ["pass-one", "pass-two"]) {
      const actorPlayerId = state.currentPlayerId;
      engine.handleCommand(state, {
        type: "pass",
        ...envelope(state, actorPlayerId, requestId),
      });
    }
    expect(state.currentPlayerId).toBe(leader);
    expect(state.currentCombination).toBeUndefined();
    expect(state.consecutivePasses).toBe(0);
    const before = JSON.stringify(state);
    expect(() => engine.handleCommand(state, {
      type: "pass",
      ...envelope(state, leader, "free-pass"),
    })).toThrow("拥有自由出牌权时不能不要");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("finishes the game, counts a bomb, and calculates spring scoring", () => {
    const { engine, state } = fixture();
    bidThree(engine, state);
    const landlord = state.currentPlayerId;
    state.hands[landlord] = cardIds(8, 4);
    const transition = engine.handleCommand(state, {
      type: "play_cards",
      cardIds: [...state.hands[landlord]!],
      ...envelope(state, landlord, "winning-bomb"),
    });
    expect(state).toMatchObject({
      phase: "game_over",
      winner: "landlord",
      bombCount: 1,
      result: {
        baseScore: 3,
        multiplier: 4,
        spring: true,
        antiSpring: false,
      },
    });
    expect(engine.actingPlayerIds(state)).toEqual([]);
    expect(transition.events.map(event => event.type)).toContain("doudizhu:game-over");
  });
});

describe("doudizhu engine command integrity", () => {
  it("deduplicates a successful request before checking its stale envelope", () => {
    const { engine, state } = fixture();
    const command: DouDizhuCommand = {
      type: "bid",
      bid: 1,
      ...envelope(state, state.currentPlayerId, "same-request"),
    };
    const first = engine.handleCommand(state, command);
    const revision = state.revision;
    const second = engine.handleCommand(state, command);
    expect(first.changed).toBe(true);
    expect(second).toMatchObject({ changed: false, events: [] });
    expect(state.revision).toBe(revision);
  });

  it("does not remove a card twice when a play request is repeated", () => {
    const { engine, state } = fixture();
    bidThree(engine, state);
    const actorPlayerId = state.currentPlayerId;
    const command: DouDizhuCommand = {
      type: "play_cards",
      cardIds: [state.hands[actorPlayerId]![0]!],
      ...envelope(state, actorPlayerId, "repeat-play"),
    };
    engine.handleCommand(state, command);
    const handAfterFirstSubmission = [...state.hands[actorPlayerId]!];
    const revisionAfterFirstSubmission = state.revision;
    const repeated = engine.handleCommand(state, command);
    expect(repeated.changed).toBe(false);
    expect(state.hands[actorPlayerId]).toEqual(handAfterFirstSubmission);
    expect(state.revision).toBe(revisionAfterFirstSubmission);
  });

  it("restarts with a fresh round while preserving monotonic revision", () => {
    const { engine, state } = fixture();
    bidThree(engine, state);
    const previousRevision = state.revision;
    const restarted = engine.handleCommand(state, {
      type: "restart_game",
      ...envelope(state, state.playerIds[0], "restart"),
    }).state;
    expect(restarted).toMatchObject({
      phase: "bidding",
      revision: previousRevision + 1,
      processedRequestIds: expect.arrayContaining(["bid-three", "restart"]),
    });
    expect(Object.values(restarted.hands).map(hand => hand.length)).toEqual([17, 17, 17]);
  });
});
