import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

type DurableObjectIdLike = {
  toString(): string;
};

type DurableObjectStateLike = {
  id: DurableObjectIdLike;
  storage: DurableObjectStorageLike;
};

/**
 * D3 Durable Object persistence shell.
 *
 * The object persists only platform-neutral RoomSnapshot values. Connection
 * state remains runtime-owned and will be rebound through the identity contract
 * when realtime WebSockets arrive in D4.
 */
export class GameRoomDurableObject {
  private readonly snapshots: CloudflareRoomSnapshotRepository;

  constructor(private readonly state: DurableObjectStateLike) {
    this.snapshots = new CloudflareRoomSnapshotRepository(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/identity" && request.method === "GET") {
      return Response.json({
        ok: true,
        objectId: this.state.id.toString(),
      });
    }

    if (url.pathname === "/snapshot" && request.method === "GET") {
      const snapshot = await this.snapshots.load();
      if (!snapshot) return new Response("Not Found", { status: 404 });
      return Response.json(snapshot);
    }

    if (url.pathname === "/snapshot" && request.method === "PUT") {
      const snapshot = await request.json() as RoomSnapshot;
      await this.snapshots.save(snapshot);
      return Response.json({ ok: true, revision: snapshot.revision });
    }

    if (url.pathname === "/snapshot" && request.method === "DELETE") {
      const deleted = await this.snapshots.clear();
      return Response.json({ ok: true, deleted });
    }

    return new Response("Not Found", { status: 404 });
  }
}
