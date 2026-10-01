import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { SimulatorLabCoordinator } from "../dev/SimulatorLabCoordinator.js";
import { mountSimulatorLab } from "../dev/SimulatorLabServer.js";

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

  it("supports full-client entry create/join and stored-session continue before game flow", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.resetDevices(5);

    expect(state.roomId).toBeNull();
    expect(state.clients).toHaveLength(5);
    expect(state.clients.every(client => !client.joined)).toBe(true);
    expect(state.clients.every(client => client.connectionStatus === "Idle")).toBe(true);

    state = await coordinator.createRoom("P1", "Host");
    expect(state.roomId).toMatch(/^\d{4}$/u);
    expect(state.clients[0]).toMatchObject({
      label: "P1",
      name: "Host",
      joined: true,
      recoverable: true,
      connectionStatus: "Connected",
      isHost: true,
    });

    const roomId = state.roomId!;
    state = await coordinator.joinRoom("P2", roomId, "Guest");
    expect(state.clients[1]).toMatchObject({
      label: "P2",
      name: "Guest",
      joined: true,
      recoverable: true,
      connectionStatus: "Connected",
    });
    expect(state.clients[0]?.roomRevision).toBe(1);
    expect(state.clients[1]?.roomRevision).toBe(1);

    state = coordinator.closeDevice("P2");
    expect(state.clients[1]).toMatchObject({
      joined: false,
      recoverable: true,
      connectionStatus: "Idle",
      roomProjection: null,
      playerView: null,
    });

    state = await coordinator.continueDevice("P2");
    expect(state.clients[1]).toMatchObject({
      joined: true,
      recoverable: true,
      connectionStatus: "Connected",
    });
    expect(state.clients[1]?.roomProjection).toMatchObject({
      roomId,
      viewer: { playerId: state.clients[1]?.playerId },
    });
  });

  it("accepts a four-digit room code through the Simulator HTTP join adapter", async () => {
    const app = express();
    coordinator = mountSimulatorLab(app);
    const server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Simulator test server did not expose a TCP address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const postJson = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const reset = await postJson("/dev/simulator/api/devices/reset", { deviceCount: 2 });
      expect(reset.status).toBe(200);

      const create = await postJson("/dev/simulator/api/room/create", {
        label: "P1",
        name: "Host",
      });
      expect(create.status).toBe(200);
      const created = await create.json() as { roomId: string };
      expect(created.roomId).toMatch(/^\d{4}$/u);

      const join = await postJson("/dev/simulator/api/room/join", {
        label: "P2",
        name: "Guest",
        roomCode: created.roomId,
      });
      expect(join.status).toBe(200);
      const joined = await join.json() as {
        clients: Array<{ label: string; joined: boolean; connectionStatus: string }>;
      };
      expect(joined.clients.find(client => client.label === "P2")).toMatchObject({
        joined: true,
        connectionStatus: "Connected",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
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

  it("orchestrates first-night wake/info steps through production commands until dawn", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.reset(7);
    const owner = state.clients[0]!;

    state = (
      await coordinator.sendCommand(
        owner.playerId,
        "botc.startGame",
        {},
        "pv3a-start",
      )
    ).state;

    for (const [index, client] of state.clients.entries()) {
      state = (
        await coordinator.sendCommand(
          client.playerId,
          "botc.confirmRole",
          {},
          `pv3a-confirm-${index + 1}`,
        )
      ).state;
    }

    const started = await coordinator.sendCommand(
      owner.playerId,
      "botc.beginFirstNight",
      {},
      "pv3a-begin-first-night",
    );
    state = started.state;
    expect(started.result).toMatchObject({
      replayed: false,
      outcome: {
        kind: "firstNightStarted",
        firstStepId: "minion_info",
        nightComplete: false,
      },
    });

    const minion = state.clients.find(client => {
      const view = client.playerView as { minionInfo?: unknown } | null;
      return Boolean(view?.minionInfo);
    });
    expect(minion?.playerView).toMatchObject({
      phase: "first_night",
      mode: "night_wake",
      nightStep: { id: "minion_info", kind: "system_info" },
      minionInfo: {
        demonPlayerId: expect.any(String),
        fellowMinionPlayerIds: expect.any(Array),
      },
    });
    expect(
      state.clients.filter(client => {
        const view = client.playerView as { minionInfo?: unknown } | null;
        return Boolean(view?.minionInfo);
      }),
    ).toHaveLength(1);

    state = (
      await coordinator.sendCommand(
        owner.playerId,
        "botc.completeNightStep",
        {},
        "pv3a-complete-minion-info",
      )
    ).state;

    const demon = state.clients.find(client => {
      const view = client.playerView as { demonInfo?: unknown } | null;
      return Boolean(view?.demonInfo);
    });
    expect(demon?.playerView).toMatchObject({
      phase: "first_night",
      mode: "night_wake",
      nightStep: { id: "demon_info", kind: "system_info" },
      demonInfo: {
        minionPlayerIds: expect.any(Array),
        bluffRoles: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String) }),
        ]),
      },
    });

    let step = 0;
    while (true) {
      const projection = state.clients[0]!.roomProjection as
        | { game?: { phase?: string } }
        | null;
      if (projection?.game?.phase !== "first_night") break;
      step += 1;
      expect(step).toBeLessThan(20);

      const informationActor = state.clients.find(client => {
        const view = client.playerView as
          | {
              privateInformation?: unknown;
            }
          | null;
        return Boolean(view?.privateInformation);
      });
      const choiceActor = state.clients.find(client => {
        const view = client.playerView as
          | {
              nightStep?: {
                choice?: {
                  allowedPlayerIds?: string[];
                  minTargets?: number;
                };
              };
            }
          | null;
        return Boolean(
          view?.nightStep?.choice?.allowedPlayerIds?.length,
        );
      });

      if (informationActor) {
        expect(JSON.stringify(informationActor.playerView)).not.toContain(
          '"reliability"',
        );
        state = (
          await coordinator.sendCommand(
            informationActor.playerId,
            "botc.acknowledgeNightInformation",
            {},
            `pv3b2a-info-ack-${step}`,
          )
        ).state;
      } else if (choiceActor) {
        const view = choiceActor.playerView as {
          nightStep: {
            choice: {
              allowedPlayerIds: string[];
              minTargets: number;
            };
          };
        };
        const targetCount = view.nightStep.choice.minTargets;
        const selectedPlayerIds =
          view.nightStep.choice.allowedPlayerIds.slice(0, targetCount);
        state = (
          await coordinator.sendCommand(
            choiceActor.playerId,
            "botc.submitNightChoice",
            { playerIds: selectedPlayerIds },
            `pv3b1-choice-${step}`,
          )
        ).state;
      } else {
        state = (
          await coordinator.sendCommand(
            owner.playerId,
            "botc.completeNightStep",
            {},
            `pv3a-complete-${step}`,
          )
        ).state;
      }
    }

    for (const client of state.clients) {
      expect(client.playerView).toMatchObject({
        phase: "day",
        mode: "day",
      });
      expect(client.roomProjection).toMatchObject({
        game: {
          phase: "day",
          dayNumber: 1,
          nightNumber: 1,
        },
      });
    }
  });

  it("keeps first-night orchestration under Human Storyteller authority", async () => {
    coordinator = new SimulatorLabCoordinator();
    let state = await coordinator.reset(8);
    const owner = state.clients[0]!;
    const storyteller = state.clients[7]!;

    state = await coordinator.setModerator(storyteller.playerId);

    state = (
      await coordinator.sendCommand(
        storyteller.playerId,
        "botc.startGame",
        {},
        "pv3a-human-start",
      )
    ).state;

    const participants = state.clients.filter(
      client => client.playerId !== storyteller.playerId,
    );
    for (const [index, client] of participants.entries()) {
      state = (
        await coordinator.sendCommand(
          client.playerId,
          "botc.confirmRole",
          {},
          `pv3a-human-confirm-${index + 1}`,
        )
      ).state;
    }

    await expect(
      coordinator.sendCommand(
        owner.playerId,
        "botc.beginFirstNight",
        {},
        "pv3a-owner-must-not-begin",
      ),
    ).rejects.toThrow("game command requires moderator authority");

    const started = await coordinator.sendCommand(
      storyteller.playerId,
      "botc.beginFirstNight",
      {},
      "pv3a-human-begin",
    );
    state = started.state;
    expect(started.result).toMatchObject({
      outcome: {
        kind: "firstNightStarted",
        firstStepId: "minion_info",
        nightComplete: false,
      },
    });

    await expect(
      coordinator.sendCommand(
        owner.playerId,
        "botc.completeNightStep",
        {},
        "pv3a-owner-must-not-advance",
      ),
    ).rejects.toThrow("game command requires moderator authority");

    const advanced = await coordinator.sendCommand(
      storyteller.playerId,
      "botc.completeNightStep",
      {},
      "pv3a-human-advance",
    );
    expect(advanced.result).toMatchObject({
      outcome: {
        kind: "nightStepCompleted",
        completedStepId: "minion_info",
        nextStepId: "demon_info",
        nightComplete: false,
      },
    });
    expect(
      advanced.state.clients.find(
        client => client.playerId === storyteller.playerId,
      )?.roomProjection,
    ).toMatchObject({
      viewer: { isGameModerator: true },
      game: {
        phase: "first_night",
        nightStep: {
          id: "demon_info",
        },
      },
    });
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
