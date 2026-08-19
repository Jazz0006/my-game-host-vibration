import {
  CLIENT_ROOM_CLOSED,
  CLIENT_ROOM_REMOVED,
  type ClientRoomClosedPayload,
  type ClientRoomRemovedPayload,
} from "../../protocol/client/ClientRoomEvents.js";
import {
  CLIENT_SESSION_REPLACED,
  type ClientSessionReplacedPayload,
} from "../../protocol/client/ClientSessionEvents.js";
import type {
  ClientSessionRealtimeEventListener,
} from "../runtime/ClientSession.js";

export type BrowserSessionEventSource = {
  subscribeRealtimeEvents(listener: ClientSessionRealtimeEventListener): () => void;
};

export type BrowserRoomLifecycleHandlers = {
  onRemoved(payload: ClientRoomRemovedPayload): void;
  onClosed(payload: ClientRoomClosedPayload): void;
};

/**
 * Browser-facing adapter for stable session lifecycle events.
 *
 * UI composition code receives semantic callbacks instead of inspecting
 * protocol envelopes or subscribing to raw Socket.IO event names.
 */
export function attachBrowserSessionReplaced(
  session: BrowserSessionEventSource,
  onReplaced: (payload: ClientSessionReplacedPayload) => void,
): () => void {
  return session.subscribeRealtimeEvents(event => {
    if (event.type !== CLIENT_SESSION_REPLACED) return;
    const payload = event.payload as ClientSessionReplacedPayload;
    onReplaced(payload);
  });
}

/**
 * Browser-facing adapter for room membership lifecycle events.
 * These events terminate the current room context and are never replayed as
 * authoritative state after reconnect.
 */
export function attachBrowserRoomLifecycle(
  session: BrowserSessionEventSource,
  handlers: BrowserRoomLifecycleHandlers,
): () => void {
  return session.subscribeRealtimeEvents(event => {
    if (event.type === CLIENT_ROOM_REMOVED) {
      handlers.onRemoved(event.payload as ClientRoomRemovedPayload);
      return;
    }
    if (event.type === CLIENT_ROOM_CLOSED) {
      handlers.onClosed(event.payload as ClientRoomClosedPayload);
    }
  });
}
