import { describe, expect, it } from "vitest";
import {
  CLIENT_SESSION_REPLACED,
  createClientSessionReplacedEvent,
} from "../src/protocol/client/ClientSessionEvents.js";

describe("E2.3d1 session lifecycle protocol contract", () => {
  it("creates a stable session.replaced client:event envelope", () => {
    expect(
      createClientSessionReplacedEvent({
        roomId: " 1234 ",
        playerId: " player-1 ",
      }),
    ).toEqual({
      protocolVersion: 1,
      kind: "event",
      type: CLIENT_SESSION_REPLACED,
      payload: {
        roomId: "1234",
        playerId: "player-1",
      },
    });
  });

  it("rejects incomplete replacement identity", () => {
    expect(() => createClientSessionReplacedEvent({ roomId: "", playerId: "player-1" }))
      .toThrow("roomId is required");
    expect(() => createClientSessionReplacedEvent({ roomId: "1234", playerId: "   " }))
      .toThrow("playerId is required");
  });
});
