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
