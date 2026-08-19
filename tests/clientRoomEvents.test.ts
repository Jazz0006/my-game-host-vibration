import { describe, expect, it } from "vitest";
import {
  CLIENT_ROOM_CLOSED,
  CLIENT_ROOM_REMOVED,
  createClientRoomClosedEvent,
  createClientRoomRemovedEvent,
} from "../src/protocol/client/ClientRoomEvents.js";
import { CLIENT_PROTOCOL_VERSION } from "../src/protocol/client/ClientProtocol.js";

describe("E2.3e1 room lifecycle protocol contract", () => {
  it("creates the stable room.removed realtime event envelope", () => {
    expect(createClientRoomRemovedEvent(" room-1 ")).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event",
      type: CLIENT_ROOM_REMOVED,
      payload: {
        roomId: "room-1",
        reason: "removed",
      },
    });
  });

  it("creates the stable room.closed realtime event envelope", () => {
    expect(createClientRoomClosedEvent(" room-1 ")).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "event",
      type: CLIENT_ROOM_CLOSED,
      payload: {
        roomId: "room-1",
        reason: "host_closed",
      },
    });
  });

  it.each(["", "   "])("rejects an incomplete room identity", roomId => {
    expect(() => createClientRoomRemovedEvent(roomId)).toThrow("roomId is required");
    expect(() => createClientRoomClosedEvent(roomId)).toThrow("roomId is required");
  });
});
