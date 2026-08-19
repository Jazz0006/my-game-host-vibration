import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "./ClientProtocol.js";

export const CLIENT_ROOM_REMOVED = "room.removed" as const;
export const CLIENT_ROOM_CLOSED = "room.closed" as const;

export type ClientRoomRemovedPayload = {
  roomId: string;
  reason: "removed";
};

export type ClientRoomClosedPayload = {
  roomId: string;
  reason: "host_closed";
};

function requireRoomId(roomId: string): string {
  const normalized = roomId.trim();
  if (!normalized) throw new Error("roomId is required");
  return normalized;
}

export function createClientRoomRemovedEvent(
  roomId: string,
): ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_REMOVED, ClientRoomRemovedPayload> {
  return createClientRealtimeEventEnvelope(CLIENT_ROOM_REMOVED, {
    roomId: requireRoomId(roomId),
    reason: "removed",
  });
}

export function createClientRoomClosedEvent(
  roomId: string,
): ClientRealtimeEventEnvelope<typeof CLIENT_ROOM_CLOSED, ClientRoomClosedPayload> {
  return createClientRealtimeEventEnvelope(CLIENT_ROOM_CLOSED, {
    roomId: requireRoomId(roomId),
    reason: "host_closed",
  });
}
