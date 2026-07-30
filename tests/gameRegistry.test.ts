import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../src/domain/game.js";
import type { GameEngine } from "../src/games/shared/engine.js";
import {
  createGameEngineRegistry,
  GameEngineRegistry,
  GameRegistryError,
} from "../src/games/registry.js";
import { werewolfEngine } from "../src/games/werewolf/engine.js";

describe("game engine registry", () => {
  it("lists platform metadata independently from implemented engines", () => {
    const registry = createGameEngineRegistry();

    expect(registry.listMetadata().map(game => ({
      kind: game.kind,
      availability: game.availability,
      players: [game.minPlayers, game.maxPlayers],
    }))).toEqual([
      { kind: "werewolf", availability: "available", players: [5, 12] },
      { kind: "doudizhu", availability: "development", players: [3, 3] },
      { kind: "clocktower", availability: "coming_soon", players: [7, 12] },
    ]);
  });

  it("returns the available engine and rejects unknown or unavailable games", () => {
    const registry = createGameEngineRegistry();

    expect(registry.getEngine("werewolf")).toBe(werewolfEngine);
    expect(() => registry.getEngine("missing")).toThrowError(
      new GameRegistryError("未知的游戏类型"),
    );
    expect(() => registry.getEngine("doudizhu")).toThrow("斗地主暂未开放");
    expect(() => registry.getEngine("clocktower")).toThrow("血染钟楼暂未开放");
  });

  it("rejects duplicate engine registration", () => {
    const registry = new GameEngineRegistry();
    registry.register(werewolfEngine);

    expect(() => registry.register(werewolfEngine)).toThrow("游戏引擎重复注册：werewolf");
  });

  it("routes lifecycle operations to the selected engine with independent player limits", () => {
    type State = { value: number };
    type Config = { start: number };
    type Command = { type: "increment"; amount: number };
    const doudizhuEngine: GameEngine<State, Config, Command, State, State> = {
      metadata: {
        kind: "doudizhu",
        name: "斗地主",
        description: "测试引擎",
        minPlayers: 3,
        maxPlayers: 3,
        availability: "available",
      },
      createConfig(_playerCount, input) {
        return { start: (input as { start?: number } | undefined)?.start ?? 0 };
      },
      createInitialState({ config }) {
        return { value: config.start };
      },
      handleCommand(state, command) {
        return {
          state: { value: state.value + command.amount },
          events: [],
          changed: true,
        };
      },
      projectPlayerView(state) {
        return state;
      },
      projectPublicView(state) {
        return state;
      },
      projectLobbyView() {
        return {};
      },
      actingPlayerIds() {
        return [];
      },
    };
    const registry = new GameEngineRegistry([doudizhuEngine.metadata]);
    registry.register(doudizhuEngine);

    expect(registry.getMetadata("doudizhu")).toMatchObject({
      minPlayers: 3,
      maxPlayers: 3,
    });
    const config = registry.createConfig("doudizhu", 3, { start: 2 });
    const state = registry.createInitialState("doudizhu", {
      playerIds: ["one", "two", "three"],
      config,
    });
    expect(registry.handleCommand("doudizhu", state, {
      type: "increment",
      amount: 4,
    }).state).toEqual({ value: 6 });
    expect(() => registry.handleCommand("werewolf", state, {
      type: "increment",
      amount: 4,
    })).toThrow("未知的游戏类型");
  });
});

describe("werewolf engine adapter", () => {
  it("creates state and keeps roles out of the public projection", () => {
    const players = Array.from({ length: 5 }, (_, index) => ({
      id: `player-${index + 1}`,
      name: `玩家${index + 1}`,
      seat: index + 1,
      connected: true,
      isHost: index === 0,
    }));
    const state = werewolfEngine.createInitialState({
      playerIds: players.map(player => player.id),
      config: DEFAULT_GAME_CONFIG,
    });

    const privateView = werewolfEngine.projectPlayerView(state, players[0]!.id, {
      players,
      viewerIsHost: true,
    });
    const publicView = werewolfEngine.projectPublicView(state, {
      players,
      viewerIsHost: true,
    });

    expect(privateView).toMatchObject({
      phase: "role_reveal",
      mode: "role_reveal",
      role: state.roles[players[0]!.id],
    });
    expect(publicView).toMatchObject({
      phase: "role_reveal",
      aliveCount: 5,
      confirmedRoles: 0,
    });
    expect(publicView).not.toHaveProperty("roles");
    expect(JSON.stringify(publicView)).not.toContain(players[0]!.id);
  });
});
