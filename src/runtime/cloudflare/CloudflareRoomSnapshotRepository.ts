import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import { gameAdmission, isGameType } from "../../games/GameCatalog.js";

export type DurableObjectStorageLike = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  getAlarm?(): Promise<number | null>;
  setAlarm?(scheduledTimeMs: number): Promise<void>;
  deleteAlarm?(): Promise<void>;
};

const SNAPSHOT_KEY = "room:snapshot:v1";

function assertGameFormat(snapshot: RoomSnapshot): void {
  const gameType = snapshot.metadata.gameType;
  if (snapshot.game !== undefined && isGameType(gameType)) {
    gameAdmission(gameType).assertPersistedGameState?.(snapshot.game);
  }
}

/**
 * D3 persistence adapter for authoritative room recovery state.
 *
 * The repository persists RoomSnapshot rather than a Node RuntimeRoom, so
 * transport-only fields such as socketId/connected never enter Durable Object
 * storage. The key versions the room envelope; concrete games own their data
 * versions and compatibility policy through the game admission seam.
 */
export class CloudflareRoomSnapshotRepository<TSnapshot extends RoomSnapshot = RoomSnapshot> {
  constructor(private readonly storage: DurableObjectStorageLike) {}

  async load(): Promise<TSnapshot | undefined> {
    const snapshot = await this.storage.get<TSnapshot>(SNAPSHOT_KEY);
    if (snapshot) assertGameFormat(snapshot);
    return snapshot;
  }

  async save(snapshot: TSnapshot): Promise<void> {
    assertGameFormat(snapshot);
    await this.storage.put(SNAPSHOT_KEY, snapshot);
  }

  async clear(): Promise<boolean> {
    return this.storage.delete(SNAPSHOT_KEY);
  }
}
