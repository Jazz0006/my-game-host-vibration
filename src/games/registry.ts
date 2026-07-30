import type {
  AnyGameEngine,
  CreateGameInput,
  GameTransition,
  GameViewContext,
} from "./shared/engine.js";
import { werewolfEngine } from "./werewolf/engine.js";
import {
  GAME_METADATA,
  isGameKind,
  type GameKind,
  type GameMetadata,
} from "./shared/metadata.js";

export class GameRegistryError extends Error {}

export class GameEngineRegistry {
  readonly #metadata = new Map<GameKind, GameMetadata>();
  readonly #engines = new Map<GameKind, AnyGameEngine>();

  constructor(metadata: readonly GameMetadata[] = GAME_METADATA) {
    for (const game of metadata) {
      if (this.#metadata.has(game.kind)) {
        throw new GameRegistryError(`游戏元数据重复：${game.kind}`);
      }
      this.#metadata.set(game.kind, game);
    }
  }

  register(engine: AnyGameEngine): void {
    const { kind } = engine.metadata;
    if (this.#engines.has(kind)) {
      throw new GameRegistryError(`游戏引擎重复注册：${kind}`);
    }
    if (!this.#metadata.has(kind)) {
      throw new GameRegistryError(`缺少游戏元数据：${kind}`);
    }
    this.#engines.set(kind, engine);
  }

  listMetadata(): GameMetadata[] {
    return [...this.#metadata.values()];
  }

  getMetadata(kind: unknown): GameMetadata {
    if (!isGameKind(kind)) throw new GameRegistryError("未知的游戏类型");
    const metadata = this.#metadata.get(kind);
    if (!metadata) throw new GameRegistryError("未知的游戏类型");
    return metadata;
  }

  requireAvailable(kind: unknown): GameMetadata {
    const metadata = this.getMetadata(kind);
    if (metadata.availability !== "available") {
      throw new GameRegistryError(`${metadata.name}暂未开放`);
    }
    if (!this.#engines.has(metadata.kind)) {
      throw new GameRegistryError(`${metadata.name}引擎尚未注册`);
    }
    return metadata;
  }

  getEngine(kind: unknown): AnyGameEngine {
    const metadata = this.requireAvailable(kind);
    return this.#engines.get(metadata.kind)!;
  }

  createConfig(kind: unknown, playerCount: number, input?: unknown): unknown {
    return this.getEngine(kind).createConfig(playerCount, input);
  }

  createInitialState(kind: unknown, input: CreateGameInput<unknown>): unknown {
    return this.getEngine(kind).createInitialState(input);
  }

  handleCommand(kind: unknown, state: unknown, command: unknown): GameTransition<unknown> {
    return this.getEngine(kind).handleCommand(state, command);
  }

  projectPlayerView(
    kind: unknown,
    state: unknown,
    viewerPlayerId: string,
    context: GameViewContext,
  ): unknown {
    return this.getEngine(kind).projectPlayerView(state, viewerPlayerId, context);
  }

  projectPublicView(kind: unknown, state: unknown, context: GameViewContext): unknown {
    return this.getEngine(kind).projectPublicView(state, context);
  }

  projectLobbyView(kind: unknown, playerCount: number, config: unknown): unknown {
    return this.getEngine(kind).projectLobbyView(playerCount, config);
  }

  actingPlayerIds(kind: unknown, state: unknown): string[] {
    return this.getEngine(kind).actingPlayerIds(state);
  }
}

export function createGameEngineRegistry(): GameEngineRegistry {
  const registry = new GameEngineRegistry();
  registry.register(werewolfEngine);
  return registry;
}
