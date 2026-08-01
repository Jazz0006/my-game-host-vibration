import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameKind } from "../games/shared/metadata.js";

export const ROOM_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type PersistedPlayer = {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  resumeTokenHash: string;
};

export type PersistedRoom = {
  schemaVersion: typeof ROOM_SNAPSHOT_SCHEMA_VERSION;
  id: string;
  gameKind: GameKind;
  players: PersistedPlayer[];
  createdAt: number;
  updatedAt: number;
  config: unknown;
  activePrompt?: unknown;
  game?: {
    kind: GameKind;
    state: unknown;
  };
};

export type StoredGameEvent = {
  roomId: string;
  sequence: number;
  eventType: string;
  actorPlayerId?: string;
  payload?: unknown;
  createdAt: number;
};

export interface RoomStore {
  loadRooms(): PersistedRoom[];
  saveRoom(room: PersistedRoom): void;
  deleteRoom(roomId: string): void;
  deleteRoomsUpdatedBefore(timestamp: number): number;
  appendEvent(input: Omit<StoredGameEvent, "sequence" | "createdAt">): StoredGameEvent;
  listEvents(roomId: string): StoredGameEvent[];
  close(): void;
}

type SnapshotRow = { snapshot_json: string };
type EventRow = {
  room_id: string;
  sequence: number;
  event_type: string;
  actor_player_id: string | null;
  payload_json: string | null;
  created_at: number;
};

export class SqliteRoomStore implements RoomStore {
  readonly #database: DatabaseSync;
  readonly #maxEventsPerRoom: number;

  constructor(databasePath: string, options: { maxEventsPerRoom?: number } = {}) {
    if (databasePath !== ":memory:") mkdirSync(path.dirname(path.resolve(databasePath)), {
      recursive: true,
    });
    this.#maxEventsPerRoom = options.maxEventsPerRoom ?? 1000;
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS room_snapshots (
        id TEXT PRIMARY KEY,
        game_kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_player_id TEXT,
        payload_json TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(room_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS game_events_room_sequence
        ON game_events(room_id, sequence);
    `);
  }

  loadRooms(): PersistedRoom[] {
    const rows = this.#database.prepare(
      "SELECT snapshot_json FROM room_snapshots ORDER BY created_at",
    ).all() as unknown as SnapshotRow[];
    return rows.flatMap(row => {
      try {
        const snapshot = JSON.parse(row.snapshot_json) as PersistedRoom;
        return snapshot.schemaVersion === ROOM_SNAPSHOT_SCHEMA_VERSION ? [snapshot] : [];
      } catch {
        return [];
      }
    });
  }

  saveRoom(room: PersistedRoom): void {
    this.#database.prepare(`
      INSERT INTO room_snapshots (
        id, game_kind, schema_version, snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        game_kind = excluded.game_kind,
        schema_version = excluded.schema_version,
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(
      room.id,
      room.gameKind,
      room.schemaVersion,
      JSON.stringify(room),
      room.createdAt,
      room.updatedAt,
    );
  }

  deleteRoom(roomId: string): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare("DELETE FROM game_events WHERE room_id = ?").run(roomId);
      this.#database.prepare("DELETE FROM room_snapshots WHERE id = ?").run(roomId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  deleteRoomsUpdatedBefore(timestamp: number): number {
    const rows = this.#database.prepare(
      "SELECT id FROM room_snapshots WHERE updated_at < ?",
    ).all(timestamp) as unknown as Array<{ id: string }>;
    for (const row of rows) this.deleteRoom(row.id);
    return rows.length;
  }

  appendEvent(input: Omit<StoredGameEvent, "sequence" | "createdAt">): StoredGameEvent {
    const createdAt = Date.now();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database.prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM game_events WHERE room_id = ?",
      ).get(input.roomId) as unknown as { sequence: number };
      const sequence = row.sequence + 1;
      this.#database.prepare(`
        INSERT INTO game_events (
          room_id, sequence, event_type, actor_player_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.roomId,
        sequence,
        input.eventType,
        input.actorPlayerId ?? null,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        createdAt,
      );
      this.#database.prepare(`
        DELETE FROM game_events
        WHERE id IN (
          SELECT id FROM game_events
          WHERE room_id = ?
          ORDER BY sequence DESC
          LIMIT -1 OFFSET ?
        )
      `).run(input.roomId, this.#maxEventsPerRoom);
      this.#database.exec("COMMIT");
      return {
        roomId: input.roomId,
        sequence,
        eventType: input.eventType,
        ...(input.actorPlayerId ? { actorPlayerId: input.actorPlayerId } : {}),
        ...(input.payload === undefined ? {} : { payload: input.payload }),
        createdAt,
      };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listEvents(roomId: string): StoredGameEvent[] {
    const rows = this.#database.prepare(`
      SELECT room_id, sequence, event_type, actor_player_id, payload_json, created_at
      FROM game_events
      WHERE room_id = ?
      ORDER BY sequence
    `).all(roomId) as unknown as EventRow[];
    return rows.map(row => ({
      roomId: row.room_id,
      sequence: row.sequence,
      eventType: row.event_type,
      ...(row.actor_player_id ? { actorPlayerId: row.actor_player_id } : {}),
      ...(row.payload_json === null ? {} : { payload: JSON.parse(row.payload_json) as unknown }),
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.#database.close();
  }
}
