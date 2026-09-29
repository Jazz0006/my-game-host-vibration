import { describe, expect, it } from "vitest";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";
import { cloudflareWorker } from "../src/runtime/cloudflare/worker.js";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../src/runtime/cloudflare/roomRouting.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

function room(storage = new MemoryStorage()) {
  return {
    storage,
    object: new GameRoomDurableObject({
      id: { toString: () => "object-4321" },
      storage,
    }),
  };
}

async function post(
  target: GameRoomDurableObject,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return target.fetch(new Request(`https://room.internal/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("MG0 game admission and shared lobby runtime", () => {
  it("creates and joins a BotC room without inventing BotC gameplay state", async () => {
    const harness = room();

    const created = await post(harness.object, "bootstrap-create", {
      roomId: "4321",
      gameType: "botc",
      name: "Host",
    });
    expect(created.status).toBe(201);
    const host = await created.json() as {
      gameType: string;
      playerId: string;
      resumeToken: string;
    };
    expect(host.gameType).toBe("botc");

    const snapshotResponse = await harness.object.fetch(
      new Request("https://room.internal/snapshot"),
    );
    const snapshot = await snapshotResponse.json() as {
      metadata: { gameType: string };
      gameConfig: unknown;
      game?: unknown;
      membership: unknown[];
    };
    expect(snapshot.metadata.gameType).toBe("botc");
    expect(snapshot.gameConfig).toEqual({});
    expect(snapshot).not.toHaveProperty("game");
    expect(snapshot.membership).toHaveLength(1);

    const wrongClient = await post(harness.object, "bootstrap-join", {
      gameType: "werewolf",
      name: "Wrong Client",
    });
    expect(wrongClient.status).toBe(409);
    await expect(wrongClient.json()).resolves.toMatchObject({
      ok: false,
      code: "game_type_mismatch",
    });

    const joined = await post(harness.object, "bootstrap-join", {
      gameType: "botc",
      name: "Guest",
    });
    expect(joined.status).toBe(200);
    const guest = await joined.json() as {
      gameType: string;
      playerId: string;
      resumeToken: string;
      revision: number;
    };
    expect(guest).toMatchObject({
      gameType: "botc",
      revision: 1,
    });

    const ticket = await post(harness.object, "websocket-ticket", {
      playerId: guest.playerId,
      resumeToken: guest.resumeToken,
    });
    expect(ticket.status).toBe(200);
    await expect(ticket.json()).resolves.toMatchObject({
      ok: true,
      ticket: expect.any(String),
      expiresAt: expect.any(Number),
    });
  });

  it("requires a supported product gameType before allocating a public room", async () => {
    let touched = false;
    const namespace: DurableObjectNamespaceLike = {
      getByName(_name: string): DurableObjectStubLike {
        touched = true;
        return {
          fetch: async () => Response.json({ ok: true }),
        };
      },
    };

    const missing = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Host" }),
      }),
      { GAME_ROOMS: namespace },
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      code: "invalid_game_type",
    });

    const unknown = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameType: "other" }),
      }),
      { GAME_ROOMS: namespace },
    );
    expect(unknown.status).toBe(400);
    expect(touched).toBe(false);
  });
});
