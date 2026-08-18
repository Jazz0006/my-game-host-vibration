import { describe, expect, it } from "vitest";
import {
  RoomCommandRuntime,
  type RoomCommandReceiptState,
} from "../src/core/room/RoomCommandRuntime.js";

type Outcome =
  | { kind: "incremented"; value: number }
  | { kind: "lifecycle"; value: number };

type TestRoom = RoomCommandReceiptState<Outcome> & {
  value: number;
};

describe("D1.1 RoomCommandRuntime", () => {
  it("scopes command ids independently from game/domain commands", async () => {
    const runtime = new RoomCommandRuntime<Outcome, TestRoom>();
    const room: TestRoom = { value: 0 };

    const first = await runtime.execute(room, "player:p1", "same-id", () => ({
      kind: "incremented" as const,
      value: ++room.value,
    }));
    const replay = await runtime.execute(room, "player:p1", "same-id", () => ({
      kind: "incremented" as const,
      value: ++room.value,
    }));
    const otherPlayer = await runtime.execute(room, "player:p2", "same-id", () => ({
      kind: "incremented" as const,
      value: ++room.value,
    }));

    expect(first).toEqual({ outcome: { kind: "incremented", value: 1 }, replayed: false });
    expect(replay).toEqual({ outcome: first.outcome, replayed: true });
    expect(otherPlayer).toEqual({ outcome: { kind: "incremented", value: 2 }, replayed: false });
    expect(room.commandReceipts?.map(receipt => receipt.commandId)).toEqual([
      "player:p1:same-id",
      "player:p2:same-id",
    ]);
  });

  it("restores persisted receipts when an authoritative room object is reconstructed", async () => {
    const firstRuntime = new RoomCommandRuntime<Outcome, TestRoom>();
    const firstRoom: TestRoom = { value: 0 };
    const first = await firstRuntime.execute(firstRoom, "host", "restore-me", () => ({
      kind: "incremented" as const,
      value: ++firstRoom.value,
    }));

    const restoredRoom: TestRoom = {
      value: firstRoom.value,
      ...(firstRoom.commandReceipts
        ? { commandReceipts: structuredClone(firstRoom.commandReceipts) }
        : {}),
    };
    const restoredRuntime = new RoomCommandRuntime<Outcome, TestRoom>();
    const replay = await restoredRuntime.execute(restoredRoom, "host", "restore-me", () => ({
      kind: "incremented" as const,
      value: ++restoredRoom.value,
    }));

    expect(replay).toEqual({ outcome: first.outcome, replayed: true });
    expect(restoredRoom.value).toBe(1);
  });

  it("can reset receipt history for lifecycle boundaries while preserving its own retry receipt", async () => {
    const runtime = new RoomCommandRuntime<Outcome, TestRoom>();
    const room: TestRoom = { value: 0 };

    await runtime.execute(room, "player:p1", "old-command", () => ({
      kind: "incremented" as const,
      value: ++room.value,
    }));
    const lifecycle = await runtime.execute(
      room,
      "host",
      "new-lifecycle",
      () => ({ kind: "lifecycle" as const, value: room.value }),
      { resetReceiptHistory: true },
    );

    expect(room.commandReceipts).toEqual([
      { commandId: "host:new-lifecycle", result: lifecycle.outcome },
    ]);

    const replay = await runtime.execute(room, "host", "new-lifecycle", () => ({
      kind: "lifecycle" as const,
      value: 999,
    }));
    expect(replay).toEqual({ outcome: lifecycle.outcome, replayed: true });
  });
});
