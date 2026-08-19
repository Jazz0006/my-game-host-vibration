import { describe, expect, it } from "vitest";
import { AuthoritativeClientStateStore } from "../src/client/runtime/AuthoritativeClientStateStore.js";
import { createPlayerStateEnvelope } from "../src/protocol/client/ClientProtocol.js";

type View = { phase: string };

function update(
  generation: number,
  revision: number,
  roomId: string,
  playerId: string,
  phase: string,
) {
  return {
    generation,
    revision,
    envelope: createPlayerStateEnvelope(roomId, playerId, { phase }),
  };
}

describe("E2.2a AuthoritativeClientStateStore", () => {
  it("applies a newer authoritative revision", () => {
    const store = new AuthoritativeClientStateStore<View>();
    store.bindSession({ roomId: "room-1", playerId: "p1" }, 1);

    const result = store.apply(update(1, 7, "room-1", "p1", "night"));

    expect(result.status).toBe("applied");
    expect(result.snapshot.revision).toBe(7);
    expect(result.snapshot.envelope?.payload).toEqual({ phase: "night" });
  });

  it("ignores duplicate revisions and rejects stale revisions", () => {
    const store = new AuthoritativeClientStateStore<View>();
    store.bindSession({ roomId: "room-1", playerId: "p1" }, 1);
    store.apply(update(1, 10, "room-1", "p1", "day"));

    const duplicate = store.apply(update(1, 10, "room-1", "p1", "duplicate"));
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.snapshot.envelope?.payload).toEqual({ phase: "day" });

    const stale = store.apply(update(1, 9, "room-1", "p1", "stale"));
    expect(stale.status).toBe("stale-revision");
    expect(stale.snapshot.revision).toBe(10);
    expect(stale.snapshot.envelope?.payload).toEqual({ phase: "day" });

    const newer = store.apply(update(1, 11, "room-1", "p1", "night"));
    expect(newer.status).toBe("applied");
    expect(newer.snapshot.revision).toBe(11);
  });

  it("preserves the last trusted PlayerView while advancing reconnect generation", () => {
    const store = new AuthoritativeClientStateStore<View>();
    store.bindSession({ roomId: "room-1", playerId: "p1" }, 1);
    store.apply(update(1, 20, "room-1", "p1", "seer-action"));

    store.advanceGeneration(2);
    const reconnecting = store.getSnapshot();
    expect(reconnecting.generation).toBe(2);
    expect(reconnecting.revision).toBe(20);
    expect(reconnecting.envelope?.payload).toEqual({ phase: "seer-action" });

    const staleGeneration = store.apply(update(1, 21, "room-1", "p1", "late-old-sync"));
    expect(staleGeneration.status).toBe("stale-generation");
    expect(staleGeneration.snapshot.envelope?.payload).toEqual({ phase: "seer-action" });

    const freshGeneration = store.apply(update(2, 21, "room-1", "p1", "night"));
    expect(freshGeneration.status).toBe("applied");
    expect(freshGeneration.snapshot.envelope?.payload).toEqual({ phase: "night" });
  });

  it("clears authoritative state when binding a different room/player session", () => {
    const store = new AuthoritativeClientStateStore<View>();
    store.bindSession({ roomId: "room-a", playerId: "p1" }, 1);
    store.apply(update(1, 3, "room-a", "p1", "day"));

    store.bindSession({ roomId: "room-b", playerId: "p2" }, 2);
    expect(store.getSnapshot()).toEqual({
      session: { roomId: "room-b", playerId: "p2" },
      generation: 2,
      revision: null,
      envelope: null,
    });

    const wrongSession = store.apply(update(2, 4, "room-a", "p1", "old-room"));
    expect(wrongSession.status).toBe("session-mismatch");
    expect(wrongSession.snapshot.envelope).toBeNull();

    const freshSession = store.apply(update(2, 1, "room-b", "p2", "lobby"));
    expect(freshSession.status).toBe("applied");
    expect(freshSession.snapshot.envelope?.payload).toEqual({ phase: "lobby" });
  });

  it("clears state on explicit leave and rejects late results", () => {
    const store = new AuthoritativeClientStateStore<View>();
    store.bindSession({ roomId: "room-1", playerId: "p1" }, 1);
    store.apply(update(1, 5, "room-1", "p1", "night"));

    store.clearSession(2);
    expect(store.getSnapshot()).toEqual({
      session: null,
      generation: 2,
      revision: null,
      envelope: null,
    });

    const late = store.apply(update(1, 6, "room-1", "p1", "late"));
    expect(late.status).toBe("stale-generation");
    expect(late.snapshot.envelope).toBeNull();
  });
});
