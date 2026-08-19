import type { RandomProvider } from "../../core/random/RandomProvider.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import {
  allEligiblePlayersVoted,
  werewolfGameModule,
  type WerewolfCommand,
} from "../../games/werewolf/WerewolfGameModule.js";

export type WerewolfCommandOutcome =
  | { kind: "none" }
  | { kind: "broadcast" }
  | { kind: "afterNightAction" }
  | { kind: "hunterResolved" }
  | { kind: "vote"; changed: boolean; allEligibleVoted: boolean }
  | { kind: "voteClosed"; result: string };

export type WerewolfCommandActor = {
  playerId?: string;
  isHost?: boolean;
};

export type WerewolfCommandEnvironment = {
  random: RandomProvider;
  now(): number;
};

/**
 * Runtime-neutral execution of an already-created Werewolf room command.
 *
 * Node and Cloudflare adapters provide transport authentication, retry scope,
 * clock, and random implementation. The game module owns the actual rule
 * mutation, so both runtimes execute the same authoritative path.
 */
export function executeWerewolfRoomCommand<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
  command: WerewolfCommand,
  actor: WerewolfCommandActor,
  environment: WerewolfCommandEnvironment,
): WerewolfCommandOutcome {
  if (!room.game) throw new Error("game has not started");

  const result = werewolfGameModule.handleCommand(
    room.game,
    {
      ...(actor.playerId === undefined ? {} : { playerId: actor.playerId }),
      isHost: actor.isHost ?? false,
      now: environment.now(),
    },
    command,
    { random: environment.random },
  );
  room.updatedAt = environment.now();

  switch (result.outcome.kind) {
    case "roleConfirmed":
    case "stateChanged":
      return { kind: "broadcast" };

    case "nightAdvanced":
      return result.outcome.advanced
        ? { kind: "afterNightAction" }
        : { kind: "none" };

    case "hunterResolved":
      return result.outcome.advanced
        ? { kind: "hunterResolved" }
        : { kind: "none" };

    case "voteSubmitted":
      return {
        kind: "vote",
        changed: result.outcome.changed,
        allEligibleVoted:
          result.outcome.changed && allEligiblePlayersVoted(room.game),
      };

    case "voteClosed":
      return { kind: "voteClosed", result: result.outcome.result };
  }
}
