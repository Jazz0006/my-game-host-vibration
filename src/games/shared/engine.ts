import type { GameMetadata } from "./metadata.js";

export type GamePlayer = {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  isHost: boolean;
};

export type CreateGameInput<TConfig> = {
  playerIds: readonly string[];
  config: TConfig;
};

export type GameEvent = {
  type: string;
  payload?: unknown;
};

export type GameTransition<TState> = {
  state: TState;
  events: GameEvent[];
  changed: boolean;
};

export type GameViewContext = {
  players: readonly GamePlayer[];
  viewerIsHost: boolean;
};

export interface GameEngine<TState, TConfig, TCommand, TPlayerView, TPublicView> {
  readonly metadata: GameMetadata;

  createConfig(playerCount: number, input?: unknown): TConfig;

  createInitialState(input: CreateGameInput<TConfig>): TState;

  handleCommand(state: TState, command: TCommand): GameTransition<TState>;

  projectPlayerView(
    state: TState,
    viewerPlayerId: string,
    context: GameViewContext,
  ): TPlayerView;

  projectPublicView(state: TState, context: GameViewContext): TPublicView;

  projectLobbyView(playerCount: number, config: TConfig): unknown;

  actingPlayerIds(state: TState): string[];
}

export type AnyGameEngine = GameEngine<unknown, unknown, unknown, unknown, unknown>;
