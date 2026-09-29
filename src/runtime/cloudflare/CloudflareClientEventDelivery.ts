import type { ClientRealtimeEventEnvelope } from "../../protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketEventFrame,
  encodeClientRawWebSocketFrame,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  createClientRoomClosedEvent,
  createClientRoomRemovedEvent,
} from "../../protocol/client/ClientRoomEvents.js";
import { createClientSessionReplacedEvent } from "../../protocol/client/ClientSessionEvents.js";
import type { CloudflareRoomRealtime } from "./CloudflareRoomRealtime.js";

function encodeEvent<TType extends string, TPayload>(
  envelope: ClientRealtimeEventEnvelope<TType, TPayload>,
): string {
  return encodeClientRawWebSocketFrame(
    createClientRawWebSocketEventFrame(envelope),
  );
}

export function cloudflareSessionReplacedFrame(
  roomId: string,
  playerId: string,
): string {
  return encodeEvent(createClientSessionReplacedEvent({ roomId, playerId }));
}

export function emitCloudflareRoomRemoved(
  realtime: CloudflareRoomRealtime,
  roomId: string,
  playerId: string,
): number {
  return realtime.sendToPlayer(
    playerId,
    encodeEvent(createClientRoomRemovedEvent(roomId)),
  );
}

export function emitCloudflareRoomClosed(
  realtime: CloudflareRoomRealtime,
  roomId: string,
): number {
  return realtime.broadcast(
    encodeEvent(createClientRoomClosedEvent(roomId)),
  );
}
