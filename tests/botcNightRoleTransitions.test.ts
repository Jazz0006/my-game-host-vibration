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

describe("B0B2B Trouble Brewing night role transitions", () => {
  it("notifies a Scarlet Woman who became Imp before her Imp action", () => {
    const sequence = createTroubleBrewingOtherNightSequence({
      assignments: [
        assignment("poisoner", "poisoner"),
        assignment("scarlet", "scarlet_woman"),
        assignment("old-imp", "imp"),
        assignment("empath", "empath"),
      ],
      deadPlayerIds: ["old-imp"],
      diedTonightPlayerIds: [],
      roleTransitions: [
        {
          kind: "scarlet_woman_to_imp",
          playerId: "scarlet",
        },
      ],
    });

    expect(sequence.map(step => step.id)).toEqual([
      "role:poisoner",
      "role_change:scarlet_woman_to_imp",
      "role:imp",
      "role:empath",
    ]);
    expect(sequence[1]).toEqual({
      id: "role_change:scarlet_woman_to_imp",
      kind: "role_change_info",
      roleId: "imp",
      actorPlayerIds: ["scarlet"],
      transitionKind: "scarlet_woman_to_imp",
    });
    expect(sequence[2]).toEqual({
      id: "role:imp",
      kind: "role",
      roleId: "imp",
      actorPlayerIds: ["scarlet"],
      actorSource: "role_transition",
    });
  });

  it("notifies an Imp self-kill successor after the old Imp action and does not give a second Imp action", () => {
    const sequence = createTroubleBrewingOtherNightSequence({
      assignments: [
        assignment("poisoner", "poisoner"),
        assignment("old-imp", "imp"),
        assignment("ravenkeeper", "ravenkeeper"),
      ],
      deadPlayerIds: ["old-imp", "ravenkeeper"],
      diedTonightPlayerIds: ["old-imp", "ravenkeeper"],
      roleTransitions: [
        {
          kind: "imp_self_kill_to_imp",
          previousImpPlayerId: "old-imp",
          newImpPlayerId: "poisoner",
        },
      ],
    });

    expect(sequence.map(step => step.id)).toEqual([
      "role:poisoner",
      "role:imp",
      "role_change:imp_self_kill_to_imp",
      "role:ravenkeeper",
    ]);
    expect(sequence[1]).toEqual({
      id: "role:imp",
      kind: "role",
      roleId: "imp",
      actorPlayerIds: ["old-imp"],
      actorSource: "role_transition",
    });
    expect(sequence[2]).toEqual({
      id: "role_change:imp_self_kill_to_imp",
      kind: "role_change_info",
      roleId: "imp",
      actorPlayerIds: ["poisoner"],
      transitionKind: "imp_self_kill_to_imp",
    });
    expect(
      sequence.filter(step => step.id === "role:imp"),
    ).toHaveLength(1);
  });

  it("supports Scarlet Woman succession followed by that new Imp self-killing in the same night", () => {
    const sequence = createTroubleBrewingOtherNightSequence({
      assignments: [
        assignment("old-imp", "imp"),
        assignment("scarlet", "scarlet_woman"),
        assignment("baron", "baron"),
      ],
      deadPlayerIds: ["old-imp", "scarlet"],
      diedTonightPlayerIds: ["scarlet"],
      roleTransitions: [
        {
          kind: "scarlet_woman_to_imp",
          playerId: "scarlet",
        },
        {
          kind: "imp_self_kill_to_imp",
          previousImpPlayerId: "scarlet",
          newImpPlayerId: "baron",
        },
      ],
    });

    expect(sequence).toEqual([
      {
        id: "role_change:scarlet_woman_to_imp",
        kind: "role_change_info",
        roleId: "imp",
        actorPlayerIds: ["scarlet"],
        transitionKind: "scarlet_woman_to_imp",
      },
      {
        id: "role:imp",
        kind: "role",
        roleId: "imp",
        actorPlayerIds: ["scarlet"],
        actorSource: "role_transition",
      },
      {
        id: "role_change:imp_self_kill_to_imp",
        kind: "role_change_info",
        roleId: "imp",
        actorPlayerIds: ["baron"],
        transitionKind: "imp_self_kill_to_imp",
      },
    ]);
  });

  it("rejects invalid Imp self-kill successors", () => {
    expect(() =>
      createTroubleBrewingOtherNightSequence({
        assignments: [
          assignment("old-imp", "imp"),
          assignment("empath", "empath"),
        ],
        deadPlayerIds: ["old-imp"],
        diedTonightPlayerIds: ["old-imp"],
        roleTransitions: [
          {
            kind: "imp_self_kill_to_imp",
            previousImpPlayerId: "old-imp",
            newImpPlayerId: "empath",
          },
        ],
      }),
    ).toThrow("Imp self-kill transition requires an alive Minion successor");

    expect(() =>
      createTroubleBrewingOtherNightSequence({
        assignments: [
          assignment("old-imp", "imp"),
          assignment("poisoner", "poisoner"),
        ],
        deadPlayerIds: ["old-imp", "poisoner"],
        diedTonightPlayerIds: ["old-imp"],
        roleTransitions: [
          {
            kind: "imp_self_kill_to_imp",
            previousImpPlayerId: "old-imp",
            newImpPlayerId: "poisoner",
          },
        ],
      }),
    ).toThrow("Imp self-kill transition requires an alive Minion successor");
  });

  it("rejects role-transition facts that do not identify the acting character", () => {
    expect(() =>
      createTroubleBrewingOtherNightSequence({
        assignments: [
          assignment("poisoner", "poisoner"),
          assignment("baron", "baron"),
        ],
        deadPlayerIds: ["poisoner"],
        diedTonightPlayerIds: ["poisoner"],
        roleTransitions: [
          {
            kind: "imp_self_kill_to_imp",
            previousImpPlayerId: "poisoner",
            newImpPlayerId: "baron",
          },
        ],
      }),
    ).toThrow("Imp self-kill transition must reference the acting Imp");

    expect(() =>
      createTroubleBrewingOtherNightSequence({
        assignments: [
          assignment("baron", "baron"),
          assignment("poisoner", "poisoner"),
        ],
        deadPlayerIds: [],
        diedTonightPlayerIds: [],
        roleTransitions: [
          {
            kind: "scarlet_woman_to_imp",
            playerId: "baron",
          },
        ],
      }),
    ).toThrow("Scarlet Woman transition must reference the Scarlet Woman");
  });

  it("rejects duplicate transition facts of the same kind", () => {
    expect(() =>
      createTroubleBrewingOtherNightSequence({
        assignments: [
          assignment("scarlet", "scarlet_woman"),
          assignment("imp", "imp"),
        ],
        deadPlayerIds: ["imp"],
        diedTonightPlayerIds: [],
        roleTransitions: [
          {
            kind: "scarlet_woman_to_imp",
            playerId: "scarlet",
          },
          {
            kind: "scarlet_woman_to_imp",
            playerId: "scarlet",
          },
        ],
      }),
    ).toThrow("Trouble Brewing night contains duplicate role transitions");
  });
});
