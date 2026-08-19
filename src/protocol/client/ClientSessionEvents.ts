import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "./ClientProtocol.js";

export const CLIENT_SESSION_REPLACED = "session.replaced" as const;

export type ClientSessionReplacedPayload = {
  roomId: string;
  playerId: string;
};

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

/**
 * Stable transport-neutral session lifecycle event contracts.
 *
 * Session lifecycle events are not authoritative game state and must not be
 * replayed after reconnect. They communicate connection/session ownership
 * changes that require the client runtime to react immediately.
 */
export function createClientSessionReplacedEvent(
  payload: ClientSessionReplacedPayload,
): ClientRealtimeEventEnvelope<typeof CLIENT_SESSION_REPLACED, ClientSessionReplacedPayload> {
  return createClientRealtimeEventEnvelope(CLIENT_SESSION_REPLACED, {
    roomId: requireNonEmptyString(payload.roomId, "roomId"),
    playerId: requireNonEmptyString(payload.playerId, "playerId"),
  });
}
