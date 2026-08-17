import type { GameEventDraft } from "../events/GameEvent.js";
import type { RandomProvider } from "../random/RandomProvider.js";

export type GameCommandContext = {
  playerId?: string;
  isHost: boolean;
  now: number;
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

  getPlayerView(state: TState, playerId: string): TPlayerView;

  getHostView(state: TState): THostView;

  getPublicView(state: TState): TPublicView;
}
