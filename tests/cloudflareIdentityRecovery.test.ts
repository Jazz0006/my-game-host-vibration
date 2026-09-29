import { describe, expect, it } from "vitest";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";

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

function room(storage: MemoryStorage) {
  return new GameRoomDurableObject({
    id: { toString: () => "object-4321" },
    storage,
  });
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

async function createTwoPlayers(storage: MemoryStorage) {
  const first = room(storage);
  const created = await post(first, "bootstrap-create", {
    roomId: "4321",
    name: "Host",
  });
  const host = await created.json() as {
    playerId: string;
    resumeToken: string;
  };

  const joined = await post(first, "bootstrap-join", { name: "Guest" });
  const guest = await joined.json() as {
    playerId: string;
    resumeToken: string;
  };
  return { host, guest };
}

describe("W3D3 Cloudflare identity recovery authority", () => {
  it("persists a one-time grant across DO reconstruction, rotates credentials, and fences old tickets", async () => {
    const storage = new MemoryStorage();
    const { host, guest } = await createTwoPlayers(storage);

    const ticketResponse = await post(room(storage), "websocket-ticket", {
      playerId: guest.playerId,
      resumeToken: guest.resumeToken,
    });
    expect(ticketResponse.status).toBe(200);
    const oldTicket = await ticketResponse.json() as { ticket: string };

    const issued = await post(room(storage), "identity-recovery", {
      operation: "issue",
      playerId: host.playerId,
      resumeToken: host.resumeToken,
      targetPlayerId: guest.playerId,
    });
    expect(issued.status).toBe(200);
    const grant = await issued.json() as {
      ok: boolean;
      recoveryCode: string;
      expiresAt: number;
    };
    expect(grant.ok).toBe(true);
    expect(grant.recoveryCode).toMatch(/^\d{6}$/u);
    expect(JSON.stringify([...storage.values.values()])).not.toContain(grant.recoveryCode);

    const claimed = await post(room(storage), "identity-recovery", {
      operation: "claim",
      recoveryCode: grant.recoveryCode,
    });
    expect(claimed.status).toBe(200);
    const session = await claimed.json() as {
      ok: boolean;
      roomId: string;
      playerId: string;
      resumeToken: string;
      revision: number;
    };
    expect(session).toMatchObject({
      ok: true,
      roomId: "4321",
      playerId: guest.playerId,
      revision: 2,
    });
    expect(session.resumeToken).not.toBe(guest.resumeToken);

    const oldCredential = await post(room(storage), "websocket-ticket", {
      playerId: guest.playerId,
      resumeToken: guest.resumeToken,
    });
    expect(oldCredential.status).toBe(401);

    const newCredential = await post(room(storage), "websocket-ticket", {
      playerId: guest.playerId,
      resumeToken: session.resumeToken,
    });
    expect(newCredential.status).toBe(200);

    const oldTicketUpgrade = await room(storage).fetch(
      new Request(`https://room.internal/websocket?ticket=${oldTicket.ticket}`, {
        method: "GET",
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(oldTicketUpgrade.status).toBe(401);

    const replay = await post(room(storage), "identity-recovery", {
      operation: "claim",
      recoveryCode: grant.recoveryCode,
    });
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_or_expired",
    });
  });

  it("invalidates an outstanding recovery grant when the original credential resumes normally", async () => {
    const storage = new MemoryStorage();
    const { host, guest } = await createTwoPlayers(storage);

    const issued = await post(room(storage), "identity-recovery", {
      operation: "issue",
      playerId: host.playerId,
      resumeToken: host.resumeToken,
      targetPlayerId: guest.playerId,
    });
    const grant = await issued.json() as { recoveryCode: string };

    const resumed = await post(room(storage), "websocket-ticket", {
      playerId: guest.playerId,
      resumeToken: guest.resumeToken,
    });
    expect(resumed.status).toBe(200);

    const claim = await post(room(storage), "identity-recovery", {
      operation: "claim",
      recoveryCode: grant.recoveryCode,
    });
    expect(claim.status).toBe(401);
    await expect(claim.json()).resolves.toMatchObject({
      code: "invalid_or_expired",
    });
  });

  it("persists failed-attempt lockout across repeated DO reconstruction", async () => {
    const storage = new MemoryStorage();
    const { host, guest } = await createTwoPlayers(storage);

    const issued = await post(room(storage), "identity-recovery", {
      operation: "issue",
      playerId: host.playerId,
      resumeToken: host.resumeToken,
      targetPlayerId: guest.playerId,
    });
    const grant = await issued.json() as { recoveryCode: string };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await post(room(storage), "identity-recovery", {
        operation: "claim",
        recoveryCode: "not-a-code",
      });
      expect(wrong.status).toBe(401);
    }

    const claim = await post(room(storage), "identity-recovery", {
      operation: "claim",
      recoveryCode: grant.recoveryCode,
    });
    expect(claim.status).toBe(401);
  });
});
