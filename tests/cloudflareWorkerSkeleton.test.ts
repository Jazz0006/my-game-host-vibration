import { describe, expect, it } from "vitest";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";
import { cloudflareWorker } from "../src/runtime/cloudflare/worker.js";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../src/runtime/cloudflare/roomRouting.js";

class IdentityNamespace implements DurableObjectNamespaceLike {
  readonly requestedNames: string[] = [];

  getByName(name: string): DurableObjectStubLike {
    this.requestedNames.push(name);
    return {
      fetch: async request => {
        const path = new URL(request.url).pathname;
        return Response.json({ roomName: name, path });
      },
    };
  }
}

describe("D2.1 Cloudflare runtime skeleton", () => {
  it("serves a runtime health endpoint without touching a room", async () => {
    const namespace = new IdentityNamespace();
    const response = await cloudflareWorker.fetch(
      new Request("https://example.test/health"),
      { GAME_ROOMS: namespace },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runtime: "cloudflare" });
    expect(namespace.requestedNames).toEqual([]);
  });

  it("routes a four-digit room path through the Durable Object namespace", async () => {
    const namespace = new IdentityNamespace();
    const response = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms/4321/identity"),
      { GAME_ROOMS: namespace },
    );

    expect(namespace.requestedNames).toEqual(["4321"]);
    expect(await response.json()).toEqual({
      roomName: "4321",
      path: "/identity",
    });
  });

  it("exposes the minimal Durable Object identity endpoint", async () => {
    const room = new GameRoomDurableObject({
      id: { toString: () => "object-123" },
    });
    const response = await room.fetch(new Request("https://room.internal/identity"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, objectId: "object-123" });
  });
});
