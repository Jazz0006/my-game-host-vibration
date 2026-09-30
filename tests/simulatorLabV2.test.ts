import { afterEach, describe, expect, it } from "vitest";
import { SimulatorLabCoordinator } from "../dev/SimulatorLabCoordinator.js";

describe("SIM-0 Simulator Lab V2 foundation", () => {
  let coordinator: SimulatorLabCoordinator | null = null;

  afterEach(() => {
    coordinator?.dispose();
    coordinator = null;
  });

  it("creates an eight-client BotC room over production bootstrap/realtime/projection seams", async () => {
    coordinator = new SimulatorLabCoordinator();
    const state = await coordinator.reset(8);

    expect(state.initialized).toBe(true);
    expect(state.gameType).toBe("botc");
    expect(state.roomId).toMatch(/^\d{4}$/u);
    expect(state.playerCount).toBe(8);
    expect(state.roomRevision).toBe(7);
    expect(state.clients).toHaveLength(8);

    const playerIds = new Set(state.clients.map(client => client.playerId));
    expect(playerIds.size).toBe(8);

    for (const client of state.clients) {
      expect(client.connectionStatus).toBe("Connected");
      expect(client.roomRevision).toBe(7);
      expect(client.playerRevision).toBe(7);
      expect(client.roomProjection).toMatchObject({
        roomId: state.roomId,
        gameType: "botc",
        viewer: { playerId: client.playerId },
        gameStarted: false,
      });
      expect(client.playerView).toMatchObject({
        phase: "lobby",
        mode: "lobby",
      });
    }
  });

  it("uses semantic room commands for Ready, storyteller assignment, rename, disconnect, and reconnect", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.reset(6);
    const host = state.clients[0]!;
    const storyteller = state.clients[1]!;
    const reconnecting = state.clients[2]!;

    const ready = await coordinator.sendCommand(
      reconnecting.playerId,
      "room.setReady",
      { ready: true },
    );
    state = ready.state;
    for (const client of state.clients) {
      expect(
        client.roomProjection?.players.find(
          player => player.id === reconnecting.playerId,
        )?.ready,
      ).toBe(true);
    }
    expect(state.roomRevision).toBe(6);

    state = await coordinator.setModerator(storyteller.playerId);
    expect(
      state.clients.find(client => client.playerId === storyteller.playerId)
        ?.isGameModerator,
    ).toBe(true);
    expect(
      state.clients.find(client => client.playerId === host.playerId)
        ?.isGameModerator,
    ).toBe(false);
    expect(state.roomRevision).toBe(7);

    const renamed = await coordinator.sendCommand(
      storyteller.playerId,
      "room.updateName",
      { name: "Storyteller" },
    );
    state = renamed.state;
    expect(
      state.clients.find(client => client.playerId === storyteller.playerId)?.name,
    ).toBe("Storyteller");
    expect(state.roomRevision).toBe(8);

    state = coordinator.disconnectPlayer(reconnecting.playerId);
    expect(
      state.clients.find(client => client.playerId === reconnecting.playerId)
        ?.connectionStatus,
    ).toBe("Disconnected");

    state = await coordinator.reconnectPlayer(reconnecting.playerId);
    const recovered = state.clients.find(
      client => client.playerId === reconnecting.playerId,
    );
    expect(recovered?.connectionStatus).toBe("Connected");
    expect(recovered?.roomRevision).toBe(8);
    expect(recovered?.generation).toBeGreaterThan(1);
  });

  it("starts Trouble Brewing through the production BotC command handler", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.reset(8);
    const owner = state.clients[0]!;

    const started = await coordinator.sendCommand(
      owner.playerId,
      "botc.startGame",
      {},
      "pv1-start",
    );
    state = started.state;

    expect(started.result).toMatchObject({
      revision: 8,
      replayed: false,
      outcome: { kind: "gameStarted" },
    });
    expect(state.roomRevision).toBe(8);
    const visibleRoles = new Set<string>();
    for (const client of state.clients) {
      expect(client.roomProjection).toMatchObject({
        gameType: "botc",
        gameStarted: true,
        game: {
          scriptId: "trouble-brewing",
          phase: "role_reveal",
          playerCount: 8,
        },
      });
      expect(client.playerView).toMatchObject({
        phase: "role_reveal",
        mode: "role_reveal",
        roleConfirmed: false,
      });
      const roleId = (client.playerView as { roleId?: string } | null)?.roleId;
      expect(roleId).toBeTruthy();
      visibleRoles.add(roleId!);
      expect(JSON.stringify(client.playerView)).not.toContain("actualRoleId");
    }

    expect(visibleRoles.size).toBe(8);
    expect(JSON.stringify(owner.roomProjection)).not.toContain("assignments");

    const replay = await coordinator.sendCommand(
      owner.playerId,
      "botc.startGame",
      {},
      "pv1-start",
    );
    expect(replay.result).toMatchObject({
      revision: 8,
      replayed: true,
      outcome: { kind: "gameStarted" },
    });
    expect(replay.state.roomRevision).toBe(8);
  });

  it("converges per-player BotC role confirmation and replays duplicate confirmation safely", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.reset(5);
    const owner = state.clients[0]!;

    state = (
      await coordinator.sendCommand(
        owner.playerId,
        "botc.startGame",
        {},
        "pv2-start",
      )
    ).state;
    expect(state.roomRevision).toBe(5);

    for (const [index, client] of state.clients.entries()) {
      const commandId = `pv2-confirm-${index + 1}`;
      const confirmed = await coordinator.sendCommand(
        client.playerId,
        "botc.confirmRole",
        {},
        commandId,
      );
      state = confirmed.state;
      expect(confirmed.result).toMatchObject({
        revision: 6 + index,
        replayed: false,
        outcome: {
          kind: "roleConfirmed",
          allConfirmed: index === state.clients.length - 1,
        },
      });
    }

    expect(state.roomRevision).toBe(10);
    for (const client of state.clients) {
      expect(client.playerView).toMatchObject({
        phase: "role_reveal",
        mode: "waiting",
        roleConfirmed: true,
      });
      expect(client.roomProjection).toMatchObject({
        game: {
          phase: "role_reveal",
          playerCount: 5,
          confirmedRoles: 5,
        },
      });
    }

    const replay = await coordinator.sendCommand(
      state.clients[4]!.playerId,
      "botc.confirmRole",
      {},
      "pv2-confirm-5",
    );
    expect(replay.result).toMatchObject({
      revision: 10,
      replayed: true,
      outcome: {
        kind: "roleConfirmed",
        allConfirmed: true,
      },
    });
    expect(replay.state.roomRevision).toBe(10);
  });

  it("gives BotC start authority to a human Storyteller and excludes them from roles", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.reset(6);
    const owner = state.clients[0]!;
    const storyteller = state.clients[5]!;

    state = await coordinator.setModerator(storyteller.playerId);
    expect(state.roomRevision).toBe(6);

    await expect(
      coordinator.sendCommand(
        owner.playerId,
        "botc.startGame",
        {},
        "owner-must-not-start",
      ),
    ).rejects.toThrow("game command requires moderator authority");

    const started = await coordinator.sendCommand(
      storyteller.playerId,
      "botc.startGame",
      {},
      "human-storyteller-start",
    );
    state = started.state;
    expect(state.roomRevision).toBe(7);

    const storytellerState = state.clients.find(
      client => client.playerId === storyteller.playerId,
    )!;
    const ownerState = state.clients.find(
      client => client.playerId === owner.playerId,
    )!;

    expect(storytellerState.playerView).toEqual({
      phase: "role_reveal",
      mode: "spectator",
    });
    await expect(
      coordinator.sendCommand(
        storyteller.playerId,
        "botc.confirmRole",
        {},
        "storyteller-must-not-confirm",
      ),
    ).rejects.toThrow("Only a seated BotC player can confirm a role");
    expect(storytellerState.roomProjection).toMatchObject({
      viewer: { isGameModerator: true },
      gameStarted: true,
      game: {
        playerCount: 5,
        assignments: expect.arrayContaining([
          expect.objectContaining({ playerId: owner.playerId }),
        ]),
      },
    });
    const storytellerProjection = storytellerState.roomProjection as
      | { game?: { assignments?: unknown[] } }
      | null;
    expect(storytellerProjection?.game?.assignments).toHaveLength(5);

    expect(ownerState.playerView).toMatchObject({
      phase: "role_reveal",
      mode: "role_reveal",
    });
    expect(JSON.stringify(ownerState.roomProjection)).not.toContain("assignments");
  });
});
