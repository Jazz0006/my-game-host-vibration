import { describe, expect, it } from "vitest";
import {
  createClientEntryPresentation,
  normalizeClientRoomCode,
} from "../src/client/ClientEntryPresentation.js";

describe("PV-UI1 shared entry presentation", () => {
  it("normalizes room code exactly like the WeChat entry page", () => {
    expect(normalizeClientRoomCode(" 12a34b5 ")).toBe("1234");
    expect(normalizeClientRoomCode(5678)).toBe("5678");
  });

  it("derives join and recoverable-room availability", () => {
    expect(createClientEntryPresentation({
      roomCode: "123",
      hasRecoverableRoom: false,
    })).toEqual({
      roomCode: "123",
      canJoinRoom: false,
      hasRecoverableRoom: false,
    });

    expect(createClientEntryPresentation({
      roomCode: "1234",
      hasRecoverableRoom: true,
    })).toEqual({
      roomCode: "1234",
      canJoinRoom: true,
      hasRecoverableRoom: true,
    });
  });
});
