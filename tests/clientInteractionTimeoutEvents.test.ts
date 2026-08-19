import { describe, expect, it } from "vitest";
import {
  CLIENT_INTERACTION_TIMEOUT_ERROR,
  CLIENT_INTERACTION_TIMEOUT_STATE,
  createClientInteractionTimeoutErrorEvent,
  createClientInteractionTimeoutStateEvent,
} from "../src/protocol/client/ClientInteractionTimeoutEvents.js";

describe("E2.3f2 interaction timeout client event contract", () => {
  it("creates an active timeout state envelope with the full stable payload", () => {
    expect(createClientInteractionTimeoutStateEvent({
      roomId: " ROOM1 ",
      active: true,
      actionId: " action-1 ",
      deadlineAt: 2000,
      warningAt: 1500,
      warning: true,
      canExtend: false,
      extensionCount: 1,
    })).toMatchObject({
      kind: "event",
      type: CLIENT_INTERACTION_TIMEOUT_STATE,
      payload: {
        roomId: "ROOM1",
        active: true,
        actionId: "action-1",
        deadlineAt: 2000,
        warningAt: 1500,
        warning: true,
        canExtend: false,
        extensionCount: 1,
      },
    });
  });

  it("creates a compact inactive timeout state envelope", () => {
    expect(createClientInteractionTimeoutStateEvent({
      roomId: "ROOM1",
      active: false,
      actionId: "action-1",
    })).toMatchObject({
      kind: "event",
      type: CLIENT_INTERACTION_TIMEOUT_STATE,
      payload: {
        roomId: "ROOM1",
        active: false,
        actionId: "action-1",
      },
    });
  });

  it("creates a stable timeout error envelope", () => {
    expect(createClientInteractionTimeoutErrorEvent({
      roomId: "ROOM1",
      actionId: "action-1",
      message: " 操作失败，请重试 ",
    })).toMatchObject({
      kind: "event",
      type: CLIENT_INTERACTION_TIMEOUT_ERROR,
      payload: {
        roomId: "ROOM1",
        actionId: "action-1",
        message: "操作失败，请重试",
      },
    });
  });

  it("rejects malformed stable timeout payloads", () => {
    expect(() => createClientInteractionTimeoutStateEvent({
      roomId: " ",
      active: false,
      actionId: "action-1",
    })).toThrow("roomId is required");

    expect(() => createClientInteractionTimeoutStateEvent({
      roomId: "ROOM1",
      active: true,
      actionId: "action-1",
      deadlineAt: Number.NaN,
      warningAt: 1500,
      warning: false,
      canExtend: true,
      extensionCount: 0,
    })).toThrow("deadlineAt must be a non-negative finite number");

    expect(() => createClientInteractionTimeoutErrorEvent({
      roomId: "ROOM1",
      actionId: "action-1",
      message: " ",
    })).toThrow("message is required");
  });
});
