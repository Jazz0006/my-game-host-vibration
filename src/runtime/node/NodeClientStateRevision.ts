import type { RuntimeRoom } from "./roomBridge.js";

const roomPlayerRevisions = new WeakMap<RuntimeRoom, Map<string, number>>();

function revisionsFor(room: RuntimeRoom): Map<string, number> {
  const existing = roomPlayerRevisions.get(room);
  if (existing) return existing;
  const revisions = new Map<string, number>();
  roomPlayerRevisions.set(room, revisions);
  return revisions;
}

/**
 * Node currently has no persisted room snapshot revision because it is still an
 * in-memory compatibility runtime. E2.2b therefore keeps a monotonic revision
 * for each authoritative PlayerView stream. Cloudflare continues to use its
 * persisted RoomSnapshot revision; ClientSession only requires a monotonic
 * revision for the bound room/player view it reconciles.
 */
export function currentNodeClientStateRevision(
  room: RuntimeRoom,
  playerId: string,
): number {
  return revisionsFor(room).get(playerId) ?? 0;
}

export function advanceNodeClientStateRevision(
  room: RuntimeRoom,
  playerId: string,
): number {
  const revisions = revisionsFor(room);
  const current = revisions.get(playerId) ?? 0;
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new Error("Node client state revision cannot advance beyond the safe integer range");
  }
  const next = current + 1;
  revisions.set(playerId, next);
  return next;
}
