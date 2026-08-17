import type { GameEventDraft } from "../events/GameEvent.js";
import type { RandomProvider } from "../random/RandomProvider.js";

export type GameCommandContext = {
  playerId?: string;
  isHost: boolean;
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

export type GameCommandResult<TState> = {
  state: TState;
  events?: GameEventDraft[];
};

export interface GameModule<
  TState,
  TCommand,
  TPlayerView,
  THostView,
  TPublicView = unknown,
  TCreateInput = unknown,
> {
  readonly type: string;

  createGame(input: TCreateInput, dependencies: GameModuleDependencies): TState;

  handleCommand(
    state: TState,
    context: GameCommandContext,
    command: TCommand,
    dependencies: GameModuleDependencies,
  ): GameCommandResult<TState>;

  getPlayerView(
    state: TState,
    playerId: string,
    context: GameViewContext,
  ): TPlayerView;

  getHostView(state: TState, context: GameViewContext): THostView;

  getPublicView(state: TState, context: GameViewContext): TPublicView;
}
