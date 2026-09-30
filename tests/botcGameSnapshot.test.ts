import { describe, expect, it } from "vitest";
import type { GameModuleDependencies } from "../src/core/game/GameModule.js";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import { encodeTroubleBrewingGameSnapshotV1 } from "../src/games/botc/TroubleBrewingGameSnapshot.js";
import { projectTroubleBrewingGameSnapshotV1 } from "../src/games/botc/TroubleBrewingGameSnapshotProjection.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

function createGame() {
  return new BotcGameModule().createGame(
    {
      playerIds: ["p1", "p2", "p3", "p4", "p5"],
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "washerwoman" },
        { playerId: "p2", actualRoleId: "drunk", shownRoleId: "empath" },
        { playerId: "p3", actualRoleId: "saint" },
        { playerId: "p4", actualRoleId: "baron" },
        { playerId: "p5", actualRoleId: "imp" },
      ],
    },
    dependencies,
  );
}

const seatOrder = ["p3", "p1", "p5", "p2", "p4"] as const;

describe("UGSM-1 Trouble Brewing canonical snapshot", () => {
  it("projects committed setup through the exact V1 semantic shape", () => {
    const snapshot = projectTroubleBrewingGameSnapshotV1(createGame(), {
      gameId: "room:2468",
      gameSeed: 20260930,
      seatOrder,
      gameStateRevision: 9,
      playerInputRevision: 4,
    });

    expect(snapshot).toEqual({
      schemaId: "botc.tb.game-snapshot",
      schemaVersion: 1,
      gameId: "room:2468",
      script: "trouble_brewing",
      gameSeed: 20260930,
      position: {
        stage: "SETUP_COMMITTED",
        phase: { state: "NOT_APPLICABLE" },
        round: { state: "NOT_APPLICABLE" },
        gameStateRevision: { state: "NOT_APPLICABLE" },
        playerInputRevision: { state: "NOT_APPLICABLE" },
      },
      grimoireSeats: [
        {
          seat: 1,
          shownRoleId: { state: "KNOWN", value: "saint" },
          actualRoleId: { state: "KNOWN", value: "saint" },
          alive: { state: "KNOWN", value: true },
          poisoned: { state: "KNOWN", value: false },
        },
        {
          seat: 2,
          shownRoleId: { state: "KNOWN", value: "washerwoman" },
          actualRoleId: { state: "KNOWN", value: "washerwoman" },
          alive: { state: "KNOWN", value: true },
          poisoned: { state: "KNOWN", value: false },
        },
        {
          seat: 3,
          shownRoleId: { state: "KNOWN", value: "imp" },
          actualRoleId: { state: "KNOWN", value: "imp" },
          alive: { state: "KNOWN", value: true },
          poisoned: { state: "KNOWN", value: false },
        },
        {
          seat: 4,
          shownRoleId: { state: "KNOWN", value: "empath" },
          actualRoleId: { state: "KNOWN", value: "drunk" },
          alive: { state: "KNOWN", value: true },
          poisoned: { state: "KNOWN", value: false },
        },
        {
          seat: 5,
          shownRoleId: { state: "KNOWN", value: "baron" },
          actualRoleId: { state: "KNOWN", value: "baron" },
          alive: { state: "KNOWN", value: true },
          poisoned: { state: "KNOWN", value: false },
        },
      ],
      setupState: {
        hasDrunk: { state: "KNOWN", value: true },
        drunkAssignmentSeat: { state: "KNOWN", value: 4 },
      },
    });
  });

  it("projects runtime phase, revisions, alive state and Poisoner state without client/runtime fields", () => {
    const game = createGame();
    game.phase = "day";
    game.dayNumber = 2;
    game.deadPlayerIds = ["p3"];
    game.poisonedPlayerId = "p5";

    const snapshot = projectTroubleBrewingGameSnapshotV1(game, {
      gameId: "room:2468",
      gameSeed: 20260930,
      seatOrder,
      gameStateRevision: 7,
      playerInputRevision: 3,
    });

    expect(snapshot.position).toEqual({
      stage: "RUNTIME",
      phase: { state: "KNOWN", value: "DAY" },
      round: { state: "KNOWN", value: 2 },
      gameStateRevision: { state: "KNOWN", value: 7 },
      playerInputRevision: { state: "KNOWN", value: 3 },
    });
    expect(snapshot.grimoireSeats[0]).toMatchObject({
      seat: 1,
      alive: { state: "KNOWN", value: false },
      poisoned: { state: "KNOWN", value: false },
    });
    expect(snapshot.grimoireSeats[2]).toMatchObject({
      seat: 3,
      alive: { state: "KNOWN", value: true },
      poisoned: { state: "KNOWN", value: true },
    });
    expect(snapshot).not.toHaveProperty("butlerMasterPlayerId");
    expect(snapshot).not.toHaveProperty("commandId");
    expect(snapshot).not.toHaveProperty("roomRevision");
  });

  it("marks unsupported revision producers NOT_APPLICABLE rather than manufacturing values", () => {
    const game = createGame();
    game.phase = "first_night";
    game.nightNumber = 1;

    const snapshot = projectTroubleBrewingGameSnapshotV1(game, {
      gameId: "room:2468",
      gameSeed: 20260930,
      seatOrder,
    });

    expect(snapshot.position).toMatchObject({
      stage: "RUNTIME",
      phase: { state: "KNOWN", value: "NIGHT" },
      round: { state: "KNOWN", value: 1 },
      gameStateRevision: { state: "NOT_APPLICABLE" },
      playerInputRevision: { state: "NOT_APPLICABLE" },
    });
  });

  it("encodes deterministic V1 JSON with the frozen interchange field order", () => {
    const snapshot = projectTroubleBrewingGameSnapshotV1(createGame(), {
      gameId: "room:2468",
      gameSeed: 20260930,
      seatOrder,
    });

    expect(encodeTroubleBrewingGameSnapshotV1(snapshot)).toBe(
      '{"schemaId":"botc.tb.game-snapshot","schemaVersion":1,"gameId":"room:2468","script":"trouble_brewing","gameSeed":20260930,"position":{"stage":"SETUP_COMMITTED","phase":{"state":"NOT_APPLICABLE"},"round":{"state":"NOT_APPLICABLE"},"gameStateRevision":{"state":"NOT_APPLICABLE"},"playerInputRevision":{"state":"NOT_APPLICABLE"}},"grimoireSeats":[{"seat":1,"shownRoleId":{"state":"KNOWN","value":"saint"},"actualRoleId":{"state":"KNOWN","value":"saint"},"alive":{"state":"KNOWN","value":true},"poisoned":{"state":"KNOWN","value":false}},{"seat":2,"shownRoleId":{"state":"KNOWN","value":"washerwoman"},"actualRoleId":{"state":"KNOWN","value":"washerwoman"},"alive":{"state":"KNOWN","value":true},"poisoned":{"state":"KNOWN","value":false}},{"seat":3,"shownRoleId":{"state":"KNOWN","value":"imp"},"actualRoleId":{"state":"KNOWN","value":"imp"},"alive":{"state":"KNOWN","value":true},"poisoned":{"state":"KNOWN","value":false}},{"seat":4,"shownRoleId":{"state":"KNOWN","value":"empath"},"actualRoleId":{"state":"KNOWN","value":"drunk"},"alive":{"state":"KNOWN","value":true},"poisoned":{"state":"KNOWN","value":false}},{"seat":5,"shownRoleId":{"state":"KNOWN","value":"baron"},"actualRoleId":{"state":"KNOWN","value":"baron"},"alive":{"state":"KNOWN","value":true},"poisoned":{"state":"KNOWN","value":false}}],"setupState":{"hasDrunk":{"state":"KNOWN","value":true},"drunkAssignmentSeat":{"state":"KNOWN","value":4}}}',
    );
  });

  it("rejects a projection context whose seat order does not match canonical assignments", () => {
    expect(() =>
      projectTroubleBrewingGameSnapshotV1(createGame(), {
        gameId: "room:2468",
        gameSeed: 20260930,
        seatOrder: ["p1", "p2", "p3", "p4", "missing"],
      }),
    ).toThrow("seat order must match canonical assignments");
  });
});
