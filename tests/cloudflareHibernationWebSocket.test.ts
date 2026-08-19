import { describe, expect, it } from "vitest";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import type { SessionTokenCryptoProvider } from "../src/core/security/SessionTokenCryptoProvider.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import {
  CloudflareRoomRealtime,
  playerWebSocketTag,
  type DurableObjectHibernationStateLike,
  type HibernationWebSocketLike,
} from "../src/runtime/cloudflare/CloudflareRoomRealtime.js";
import { CloudflareSessionTokenCryptoProvider } from "../src/runtime/cloudflare/CloudflareSessionTokenCryptoProvider.js";
import { CloudflareWebSocketTicketRepository } from "../src/runtime/cloudflare/CloudflareWebSocketTicketRepository.js";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";
import { cloudflareWorker } from "../src/runtime/cloudflare/worker.js";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../src/runtime/cloudflare/roomRouting.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

class FakeWebSocket implements HibernationWebSocketLike {
  readyState = 1;
  readonly sent: (string | ArrayBuffer)[] = [];
  closed?: { code?: number; reason?: string };
  attachment: unknown;

  send(message: string | ArrayBuffer): void {
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
}

class FakeHibernationState implements DurableObjectHibernationStateLike {
  readonly connections: Array<{ webSocket: HibernationWebSocketLike; tags: string[] }> = [];
  autoResponse: unknown;

  acceptWebSocket(webSocket: HibernationWebSocketLike, tags: string[] = []): void {
    this.connections.push({ webSocket, tags: [...tags] });
  }

  getWebSockets(tag?: string): HibernationWebSocketLike[] {
    return this.connections
      .filter(connection => connection.webSocket.readyState !== 3)
      .filter(connection => tag === undefined || connection.tags.includes(tag))
      .map(connection => connection.webSocket);
  }

  setWebSocketAutoResponse(pair: unknown): void {
    this.autoResponse = pair;
  }
}

class DeterministicCrypto implements SessionTokenCryptoProvider {
  private sequence = 0;

  randomToken(_byteLength: number): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }

  async sha256Hex(value: string): Promise<string> {
    return value.padEnd(64, "0").slice(0, 64);
  }

  timingSafeEqualHex(actualHex: string, expectedHex: string): boolean {
    return actualHex === expectedHex;
  }
}

function snapshotWithPlayer(resumeTokenHash: string) {
  return createRoomSnapshot(
    {
      id: "1234",
      gameType: "werewolf",
      players: [
        {
          id: "p1",
          name: "Host",
          seat: 1,
          isHost: true,
          resumeTokenHash,
        },
      ],
      createdAt: 10,
      updatedAt: 20,
      gameConfig: { playerCount: 5, roleDeck: ["werewolf"] },
    },
    { revision: 1 },
  );
}

describe("D4 Cloudflare Hibernation WebSocket", () => {
  it("binds stable player identity to a tag and serialized attachment", () => {
    const state = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(state);
    const player = new FakeWebSocket();
    const other = new FakeWebSocket();

    realtime.acceptPlayerSocket(player, "p1");
    realtime.acceptPlayerSocket(other, "p2");

    expect(state.getWebSockets(playerWebSocketTag("p1"))).toEqual([player]);
    expect(player.deserializeAttachment()).toEqual({ version: 1, playerId: "p1" });
    expect(realtime.playerIdForSocket(player)).toBe("p1");

    expect(realtime.sendToPlayer("p1", "private")).toBe(1);
    expect(player.sent).toEqual(["private"]);
    expect(other.sent).toEqual([]);

    expect(realtime.broadcast("public")).toBe(2);
    expect(player.sent).toEqual(["private", "public"]);
    expect(other.sent).toEqual(["public"]);
  });

  it("restores player routing after Durable Object reconstruction without an in-memory session map", () => {
    const state = new FakeHibernationState();
    const firstRuntime = new CloudflareRoomRealtime(state);
    const player = new FakeWebSocket();
    firstRuntime.acceptPlayerSocket(player, "p1");

    const reconstructedRuntime = new CloudflareRoomRealtime(state);
    expect(reconstructedRuntime.playerIdForSocket(player)).toBe("p1");
    expect(reconstructedRuntime.sendToPlayer("p1", "after-hibernation")).toBe(1);
    expect(player.sent).toEqual(["after-hibernation"]);
  });

  it("replaces an older connection for the same stable player identity", () => {
    const state = new FakeHibernationState();
    const realtime = new CloudflareRoomRealtime(state);
    const oldSocket = new FakeWebSocket();
    const newSocket = new FakeWebSocket();

    realtime.acceptPlayerSocket(oldSocket, "p1");
    realtime.acceptPlayerSocket(newSocket, "p1");

    expect(oldSocket.sent).toEqual([JSON.stringify({ type: "session:replaced" })]);
    expect(oldSocket.closed).toEqual({ code: 4001, reason: "session replaced" });
    expect(state.getWebSockets(playerWebSocketTag("p1"))).toEqual([newSocket]);
  });

  it("uses short-lived single-use WebSocket tickets", async () => {
    const storage = new MemoryStorage();
    const crypto = new DeterministicCrypto();
    let now = 1_000;
    const tickets = new CloudflareWebSocketTicketRepository(storage, crypto, () => now);

    const issued = await tickets.issue("p1", 100);
    expect(issued).toEqual({ ticket: "ticket-1", playerId: "p1", expiresAt: 1_100 });
    expect(await tickets.consume("ticket-1")).toEqual({ playerId: "p1", expiresAt: 1_100 });
    expect(await tickets.consume("ticket-1")).toBeUndefined();

    const expired = await tickets.issue("p1", 100);
    now = 1_201;
    expect(await tickets.consume(expired.ticket)).toBeUndefined();
  });

  it("exchanges a valid C1 resume token for a WebSocket ticket without exposing the token", async () => {
    const storage = new MemoryStorage();
    const crypto = new CloudflareSessionTokenCryptoProvider();
    const resumeToken = "resume-secret";
    const resumeTokenHash = await crypto.sha256Hex(resumeToken);
    await new CloudflareRoomSnapshotRepository(storage).save(snapshotWithPlayer(resumeTokenHash));

    const room = new GameRoomDurableObject({
      id: { toString: () => "object-123" },
      storage,
    });

    const response = await room.fetch(new Request("https://room.internal/websocket-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "p1", resumeToken }),
    }));
    expect(response.status).toBe(200);

    const body = await response.json() as { ok: boolean; ticket: string; expiresAt: number };
    expect(body.ok).toBe(true);
    expect(body.ticket).toBeTruthy();
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(body)).not.toContain(resumeToken);

    const denied = await room.fetch(new Request("https://room.internal/websocket-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "p1", resumeToken: "wrong" }),
    }));
    expect(denied.status).toBe(401);
  });

  it("reads serialized identity when a message wakes a reconstructed object", async () => {
    const storage = new MemoryStorage();
    const state = new FakeHibernationState();
    const stateLike = {
      id: { toString: () => "object-123" },
      storage,
      acceptWebSocket: state.acceptWebSocket.bind(state),
      getWebSockets: state.getWebSockets.bind(state),
      setWebSocketAutoResponse: state.setWebSocketAutoResponse.bind(state),
    };
    const socket = new FakeWebSocket();
    new CloudflareRoomRealtime(state).acceptPlayerSocket(socket, "p1");

    const reconstructed = new GameRoomDurableObject(stateLike);
    await reconstructed.webSocketMessage(socket, JSON.stringify({ type: "session:whoami" }));

    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "session:bound", playerId: "p1" }));
  });

  it("routes WebSocket requests to the room Durable Object and preserves the ticket query", async () => {
    let forwardedUrl = "";
    class Namespace implements DurableObjectNamespaceLike {
      getByName(_name: string): DurableObjectStubLike {
        return {
          fetch: async request => {
            forwardedUrl = request.url;
            return new Response("forwarded");
          },
        };
      }
    }

    const response = await cloudflareWorker.fetch(
      new Request("https://example.test/rooms/1234/websocket?ticket=abc123"),
      { GAME_ROOMS: new Namespace() },
    );

    expect(response.status).toBe(200);
    expect(new URL(forwardedUrl).pathname).toBe("/websocket");
    expect(new URL(forwardedUrl).searchParams.get("ticket")).toBe("abc123");
  });
});
