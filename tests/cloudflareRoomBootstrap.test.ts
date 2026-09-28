import { describe, expect, it } from "vitest";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";
import { cloudflareWorker } from "../src/runtime/cloudflare/worker.js";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../src/runtime/cloudflare/roomRouting.js";

function storage() {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { values.set(key, value); },
    delete: async (key: string) => values.delete(key),
  };
}

class SocketFake {
  readonly messages: string[] = [];
  readyState = 1;
  attachment: unknown;

  send(message: string | ArrayBuffer) {
    this.messages.push(String(message));
  }

  close() {}

  serializeAttachment(value: unknown) {
    this.attachment = value;
  }

  deserializeAttachment() {
    return this.attachment;
  }
}

function stateWithSockets() {
  const roomStorage = storage();
  const tagged = new Map<string, SocketFake[]>();
  const all: SocketFake[] = [];

  return {
    state: {
      id: { toString: () => "object-4321" },
      storage: roomStorage,
      acceptWebSocket(socket: SocketFake, tags: string[] = []) {
        all.push(socket);
        for (const tag of tags) {
          const sockets = tagged.get(tag) ?? [];
          sockets.push(socket);
          tagged.set(tag, sockets);
        }
      },
      getWebSockets(tag?: string) {
        return tag ? (tagged.get(tag) ?? []) : all;
      },
    },
    addTaggedSocket(tag: string, socket: SocketFake) {
      const sockets = tagged.get(tag) ?? [];
      sockets.push(socket);
      tagged.set(tag, sockets);
      all.push(socket);
    },
  };
}

describe("E3.7B Cloudflare room bootstrap", () => {
  it("creates one authoritative room session and refuses to overwrite it", async () => {
    const harness = stateWithSockets();
    const room = new GameRoomDurableObject(harness.state);

    const created = await room.fetch(new Request("https://room.internal/bootstrap-create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: "4321" }),
    }));

    expect(created.status).toBe(201);
    const session = await created.json() as Record<string, unknown>;
    expect(session).toMatchObject({
      ok: true,
      roomId: "4321",
      seat: 1,
      isHost: true,
      revision: 0,
    });
    expect(session.playerId).toEqual(expect.any(String));
    expect(session.resumeToken).toEqual(expect.any(String));
    expect(session.name).toEqual(expect.any(String));

    const snapshotResponse = await room.fetch(new Request("https://room.internal/snapshot"));
    const snapshot = await snapshotResponse.json() as {
      membership: Array<{ id: string; resumeTokenHash: string; isHost: boolean }>;
    };
    expect(snapshot.membership).toHaveLength(1);
    expect(snapshot.membership[0]?.id).toBe(session.playerId);
    expect(snapshot.membership[0]?.isHost).toBe(true);
    expect(snapshot.membership[0]?.resumeTokenHash).not.toBe(session.resumeToken);

    const duplicate = await room.fetch(new Request("https://room.internal/bootstrap-create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: "4321" }),
    }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: false,
      code: "room_already_exists",
    });
  });

  it("joins a lobby, advances revision, and pushes new authoritative state to connected members", async () => {
    const harness = stateWithSockets();
    const room = new GameRoomDurableObject(harness.state);

    const created = await room.fetch(new Request("https://room.internal/bootstrap-create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: "4321", name: "Host" }),
    }));
    const host = await created.json() as { playerId: string };

    const hostSocket = new SocketFake();
    harness.addTaggedSocket(`user:${host.playerId}`, hostSocket);

    const joined = await room.fetch(new Request("https://room.internal/bootstrap-join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Guest" }),
    }));

    expect(joined.status).toBe(200);
    const guest = await joined.json() as Record<string, unknown>;
    expect(guest).toMatchObject({
      ok: true,
      roomId: "4321",
      name: "Guest",
      seat: 2,
      isHost: false,
      revision: 1,
    });
    expect(guest.playerId).toEqual(expect.any(String));
    expect(guest.resumeToken).toEqual(expect.any(String));

    const snapshotResponse = await room.fetch(new Request("https://room.internal/snapshot"));
    const snapshot = await snapshotResponse.json() as {
      revision: number;
      membership: Array<{ name: string }>;
    };
    expect(snapshot.revision).toBe(1);
    expect(snapshot.membership.map(member => member.name)).toEqual(["Host", "Guest"]);

    const pushed = hostSocket.messages.map(message => JSON.parse(message));
    expect(pushed.filter(frame => frame.kind === "state")).toHaveLength(2);
  });

  it("keeps internal snapshots off the public Worker surface and routes public join bootstrap", async () => {
    const requests: Array<{ name: string; path: string; method: string }> = [];
    const namespace: DurableObjectNamespaceLike = {
      getByName(name: string): DurableObjectStubLike {
        return {
          fetch: async request => {
            requests.push({
              name,
              path: new URL(request.url).pathname,
              method: request.method,
            });
            return Response.json({
              ok: true,
              roomId: name,
              playerId: "p2",
              resumeToken: "resume-2",
              name: "Guest",
              seat: 2,
              isHost: false,
              revision: 1,
            });
          },
        };
      },
    };

    const snapshot = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms/4321/snapshot"),
      { GAME_ROOMS: namespace },
    );
    expect(snapshot.status).toBe(404);
    expect(requests).toEqual([]);

    const joined = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms/4321/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Guest" }),
      }),
      { GAME_ROOMS: namespace },
    );

    expect(joined.status).toBe(200);
    expect(requests).toEqual([
      { name: "4321", path: "/bootstrap-join", method: "POST" },
    ]);
  });

  it("allocates a four-digit public room code before delegating create to its Durable Object", async () => {
    const requests: Array<{ name: string; path: string; body: unknown }> = [];
    const namespace: DurableObjectNamespaceLike = {
      getByName(name: string): DurableObjectStubLike {
        return {
          fetch: async request => {
            const body = await request.json();
            requests.push({ name, path: new URL(request.url).pathname, body });
            return Response.json({
              ok: true,
              roomId: name,
              playerId: "p1",
              resumeToken: "resume-1",
              name: "Host",
              seat: 1,
              isHost: true,
              revision: 0,
            }, { status: 201 });
          },
        };
      },
    };

    const response = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Host" }),
      }),
      { GAME_ROOMS: namespace },
    );

    expect(response.status).toBe(201);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.name).toMatch(/^\d{4}$/);
    expect(requests[0]?.path).toBe("/bootstrap-create");
    expect(requests[0]?.body).toEqual({
      roomId: requests[0]?.name,
      name: "Host",
    });
  });
});
