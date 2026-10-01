import { describe, expect, it } from "vitest";
import {
  computeRoundedTableSeats,
  resolveRoundedTableRingIndex,
} from "../src/client/RoundedTableLayout.js";

describe("shared rounded-table layout", () => {
  it("keeps WeChat and Simulator seat geometry on one deterministic ring", () => {
    const participants = Object.fromEntries(
      ["p1", "p2", "p3", "p4"].map((id, index) => [
        id,
        { id, name: `Player ${index + 1}` },
      ]),
    );

    const seats = computeRoundedTableSeats(
      ["p1", "p2", "p3", "p4"],
      participants,
    );

    expect(seats.map(({ id, ringIndex, xRpx, yRpx }) => ({
      id,
      ringIndex,
      xRpx,
      yRpx,
    }))).toEqual([
      { id: "p1", ringIndex: 0, xRpx: 260, yRpx: 0 },
      { id: "p2", ringIndex: 1, xRpx: 520, yRpx: 324 },
      { id: "p3", ringIndex: 2, xRpx: 260, yRpx: 648 },
      { id: "p4", ringIndex: 3, xRpx: 0, yRpx: 324 },
    ]);

    for (const seat of seats) {
      expect(
        resolveRoundedTableRingIndex(
          seat.xRpx + 60,
          seat.yRpx + 36,
          seats.length,
        ),
      ).toBe(seat.ringIndex);
    }
  });
});
