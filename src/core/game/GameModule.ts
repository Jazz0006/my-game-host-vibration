import type { GameEventDraft } from "../events/GameEvent.js";
import type { RandomProvider } from "../random/RandomProvider.js";

export type GameCommandContext = {
  playerId?: string;
  isModerator: boolean;
  now: number;
};

export type GamePlayerRef = {
  id: string;
  name: string;
  seat: number;
};

export type GameViewContext = {
  players: readonly GamePlayerRef[];
};

export type GameModuleDependencies = {
  random: RandomProvider;
};

export type GameCommandResult<TState, TOutcome = unknown> = {
  state: TState;
  events?: GameEventDraft[];
  outcome?: TOutcome;
};

export interface GameModule<
  TState,
  TCommand,
  TPlayerView,
  TModeratorView,
  TPublicView = unknown,
  TCreateInput = unknown,
  TCommandOutcome = unknown,
> {
  readonly type: string;

  createGame(input: TCreateInput, dependencies: GameModuleDependencies): TState;

  handleCommand(
    state: TState,
    context: GameCommandContext,
    command: TCommand,
    dependencies: GameModuleDependencies,
  ): GameCommandResult<TState, TCommandOutcome>;

  getPlayerView(
    state: TState,
    playerId: string,
    context: GameViewContext,
  ): TPlayerView;

  getModeratorView(state: TState, context: GameViewContext): TModeratorView;

  getPublicView(state: TState, context: GameViewContext): TPublicView;
}
