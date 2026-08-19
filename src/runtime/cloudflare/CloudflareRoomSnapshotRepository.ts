import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";

export type DurableObjectStorageLike = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
};

const SNAPSHOT_KEY = "room:snapshot:v1";

/**
 * D3 persistence adapter for authoritative room recovery state.
 *
 * The repository persists RoomSnapshot rather than a Node RuntimeRoom, so
 * transport-only fields such as socketId/connected never enter Durable Object
 * storage. Storage schema versioning is represented by the stable key suffix.
 */
export class CloudflareRoomSnapshotRepository<TSnapshot extends RoomSnapshot = RoomSnapshot> {
  constructor(private readonly storage: DurableObjectStorageLike) {}

  load(): Promise<TSnapshot | undefined> {
    return this.storage.get<TSnapshot>(SNAPSHOT_KEY);
  }

  async save(snapshot: TSnapshot): Promise<void> {
    await this.storage.put(SNAPSHOT_KEY, snapshot);
  }

  async clear(): Promise<boolean> {
    return this.storage.delete(SNAPSHOT_KEY);
  }
}
