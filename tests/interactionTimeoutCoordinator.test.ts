import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERACTION_TIMEOUT_SECONDS,
  INTERACTION_TIMEOUT_EXTENSION_SECONDS,
  InteractionTimeoutCoordinator,
} from "../src/runtime/node/InteractionTimeoutCoordinator.js";

describe("C4.4 interaction timeout coordinator", () => {
  it("uses a 30 second default and replaces stale action timers", () => {
    const coordinator = new InteractionTimeoutCoordinator();
    expect(coordinator.getRoomTimeoutSeconds("room-1")).toBe(DEFAULT_INTERACTION_TIMEOUT_SECONDS);

    const first = coordinator.ensure("room-1", "action-a", ["p1"], 1_000);
    expect(first.created).toBe(true);
    expect(first.state?.deadlineAt).toBe(31_000);

    const same = coordinator.ensure("room-1", "action-a", ["p1"], 2_000);
    expect(same.created).toBe(false);
    expect(same.state?.deadlineAt).toBe(31_000);

    const next = coordinator.ensure("room-1", "action-b", ["p2"], 3_000);
    expect(next.created).toBe(true);
    expect(next.replaced?.actionId).toBe("action-a");
    expect(next.state?.actionId).toBe("action-b");
  });

  it("allows one interaction-level extension and never a second one", () => {
    const coordinator = new InteractionTimeoutCoordinator();
    const state = coordinator.ensure("room-1", "action-a", ["p1", "p2"], 1_000).state!;
    const originalDeadline = state.deadlineAt;

    const extended = coordinator.extend("room-1", "action-a", "p2");
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    expect(extended.state.deadlineAt).toBe(
      originalDeadline + INTERACTION_TIMEOUT_EXTENSION_SECONDS * 1000,
    );
    expect(extended.state.extensionCount).toBe(1);

    expect(coordinator.extend("room-1", "action-a", "p1")).toEqual({
      ok: false,
      message: "本次行动已经延长过一次",
    });
  });

  it("can disable automatic timeouts for a room", () => {
    const coordinator = new InteractionTimeoutCoordinator();
    expect(coordinator.setRoomTimeoutSeconds("room-1", 0)).toBe(0);
    expect(coordinator.ensure("room-1", "action-a", ["p1"], 1_000)).toEqual({
      created: false,
    });
  });
});
