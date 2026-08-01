import { DouDizhuRuleError } from "./errors.js";

export type Bid = 0 | 1 | 2 | 3;

export type BidAction = {
  playerId: string;
  bid: Bid;
};

export type BiddingState = {
  playerIds: readonly [string, string, string];
  firstBidderIndex: number;
  currentBidderIndex: number;
  highestBid: Bid;
  highestBidderId?: string;
  actions: readonly BidAction[];
  completed: boolean;
  landlordPlayerId?: string;
  redealRequired: boolean;
  nextFirstBidderIndex?: number;
};

export function createBiddingState(
  playerIds: readonly [string, string, string],
  firstBidderIndex: number,
): BiddingState {
  if (new Set(playerIds).size !== 3) {
    throw new DouDizhuRuleError("叫分玩家必须互不相同");
  }
  if (!Number.isInteger(firstBidderIndex) || firstBidderIndex < 0 || firstBidderIndex > 2) {
    throw new DouDizhuRuleError("首叫座位无效");
  }
  return {
    playerIds,
    firstBidderIndex,
    currentBidderIndex: firstBidderIndex,
    highestBid: 0,
    actions: [],
    completed: false,
    redealRequired: false,
  };
}

export function submitBid(state: BiddingState, playerId: string, bid: Bid): BiddingState {
  if (state.completed) throw new DouDizhuRuleError("叫分已经结束");
  if (![0, 1, 2, 3].includes(bid)) throw new DouDizhuRuleError("叫分只能是不叫、1分、2分或3分");
  const expectedPlayerId = state.playerIds[state.currentBidderIndex];
  if (playerId !== expectedPlayerId) throw new DouDizhuRuleError("尚未轮到该玩家叫分");
  if (state.actions.some(action => action.playerId === playerId)) {
    throw new DouDizhuRuleError("每名玩家每轮只能叫分一次");
  }
  if (bid !== 0 && bid <= state.highestBid) {
    throw new DouDizhuRuleError("叫分必须高于当前最高分");
  }

  const actions = [...state.actions, { playerId, bid }];
  const highestBid = bid > state.highestBid ? bid : state.highestBid;
  const highestBidderId = bid > state.highestBid ? playerId : state.highestBidderId;

  if (bid === 3) {
    return {
      ...state,
      highestBid,
      highestBidderId: playerId,
      actions,
      completed: true,
      landlordPlayerId: playerId,
    };
  }

  if (actions.length === 3) {
    if (!highestBidderId) {
      return {
        ...state,
        highestBid: 0,
        actions,
        completed: true,
        redealRequired: true,
        nextFirstBidderIndex: (state.firstBidderIndex + 1) % 3,
      };
    }
    return {
      ...state,
      highestBid,
      highestBidderId,
      actions,
      completed: true,
      landlordPlayerId: highestBidderId,
    };
  }

  return {
    ...state,
    highestBid,
    ...(highestBidderId ? { highestBidderId } : {}),
    actions,
    currentBidderIndex: (state.currentBidderIndex + 1) % 3,
  };
}
