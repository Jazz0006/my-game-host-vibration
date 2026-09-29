import { describe, expect, it } from "vitest";
import {
  createTroubleBrewingOtherNightSequence,
  type BotcNightAssignment,
} from "../src/games/botc/TroubleBrewingNightSequence.js";

function assignment(
  playerId: string,
  actualRoleId: BotcNightAssignment["actualRoleId"],
  shownRoleId: BotcNightAssignment["shownRoleId"] = actualRoleId,
): BotcNightAssignment {
  return { playerId, actualRoleId, shownRoleId };
}

describe("B0B2A Trouble Brewing other-night eligibility", () => {
  it("keeps canonical relative order while filtering to currently eligible actors", () => {
    const sequence = createTroubleBrewingOtherNightSequence({
      assignments: [
        assignment("poisoner", "poisoner"),
        assignment("monk", "monk"),
        assignment("spy", "spy"),
        assignment("scarlet", "scarlet_woman"),
        assignment("imp", "imp"),
        assignment("ravenkeeper", "ravenkeeper"),
        assignment("undertaker", "undertaker"),
        assignment("empath", "empath"),
        assignment("fortune", "fortune_teller"),
        assignment("butler", "butler"),
      ],
      deadPlayerIds: ["ravenkeeper"],
      diedTonightPlayerIds: ["ravenkeeper"],
      executedAndDiedTodayPlayerId: "executed-player",
    });

    expect(sequence.map(step => step.id)).toEqual([
      "role:poisoner",
      "role:monk",
      "role:spy",
      "role:imp",
      "role:ravenkeeper",
      "role:undertaker",
      "role:empath",
      "role:fortune_teller",
      "role:butler",
    ]);
  });

  it("does not wake ordinary dead actors but still wakes a Ravenkeeper who died tonight", () => {
    const sequence = createTroubleBrewingOtherNightSequence({
      assignments: [
        assignment("poisoner", "poisoner"),
        assignment("monk", "monk"),
        assignment("ravenkeeper", "ravenkeeper"),
        assignment("empath", "empath"),
      ],
      deadPlayerIds: ["poisoner", "ravenkeeper", "empath"],
      diedTonightPlayerIds: ["ravenkeeper"],
    });

    expect(sequence).toEqual([
      {
        id: "role:monk",
        kind: "role",
        roleId: "monk",
        actorPlayerIds: ["monk"],
        actorSource: "actual",
      },
      {
        id: "role:ravenkeeper",
        kind: "role",
        roleId: "ravenkeeper",
        actorPlayerIds: ["ravenkeeper"],
        actorSource: "actual",
      },
    ]);
  });

  it("wakes Undertaker only when a player was executed and died today", () => {
    const assignments = [assignment("undertaker", "undertaker")];

    expect(
      createTroubleBrewingOtherNightSequence({
        assignments,
        deadPlayerIds: [],
        diedTonightPlayerIds: [],
      }),
    ).toEqual([]);

    expect(
      createTroubleBrewingOtherNightSequence({
        assignments,
        deadPlayerIds: [],
        diedTonightPlayerIds: [],
        executedAndDiedTodayPlayerId: "p7",
      }),
    ).toEqual([
      {
        id: "role:undertaker",
        kind: "role",
        roleId: "undertaker",
        actorPlayerIds: ["undertaker"],
        actorSource: "actual",
      },
    ]);
  });

  it("uses the Drunk shown Townsfolk for later-night wake eligibility", () => {
    expect(
      createTroubleBrewingOtherNightSequence({
        assignments: [assignment("drunk", "drunk", "monk")],
        deadPlayerIds: [],
        diedTonightPlayerIds: [],
      }),
    ).toEqual([
      {
        id: "role:monk",
        kind: "role",
        roleId: "monk",
        actorPlayerIds: ["drunk"],
        actorSource: "shown_drunk",
      },
    ]);

    expect(
      createTroubleBrewingOtherNightSequence({
        assignments: [assignment("drunk", "drunk", "ravenkeeper")],
        deadPlayerIds: ["drunk"],
        diedTonightPlayerIds: ["drunk"],
      }),
    ).toEqual([
      {
        id: "role:ravenkeeper",
        kind: "role",
        roleId: "ravenkeeper",
        actorPlayerIds: ["drunk"],
        actorSource: "shown_drunk",
      },
    ]);

    expect(
      createTroubleBrewingOtherNightSequence({
        assignments: [assignment("drunk", "drunk", "undertaker")],
        deadPlayerIds: [],
        diedTonightPlayerIds: [],
        executedAndDiedTodayPlayerId: "p7",
      }),
    ).toEqual([
      {
        id: "role:undertaker",
        kind: "role",
        roleId: "undertaker",
        actorPlayerIds: ["drunk"],
        actorSource: "shown_drunk",
      },
    ]);
  });

  it("does not treat Scarlet Woman as an ordinary recurring wake", () => {
    expect(
      createTroubleBrewingOtherNightSequence({
        assignments: [assignment("scarlet", "scarlet_woman")],
        deadPlayerIds: [],
        diedTonightPlayerIds: [],
      }),
    ).toEqual([]);
  });
});
