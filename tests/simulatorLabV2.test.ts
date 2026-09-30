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
});
