import {
  CLIENT_INTERACTION_TIMEOUT_ERROR,
  CLIENT_INTERACTION_TIMEOUT_STATE,
  type ClientInteractionTimeoutErrorPayload,
  type ClientInteractionTimeoutStatePayload,
} from "../../protocol/client/ClientInteractionTimeoutEvents.js";
import type {
  ClientSessionRealtimeEventListener,
} from "../runtime/ClientSession.js";

export type BrowserInteractionTimeoutEventSource = {
  subscribeRealtimeEvents(listener: ClientSessionRealtimeEventListener): () => void;
};

export type BrowserInteractionTimeoutHandlers = {
  onState(payload: ClientInteractionTimeoutStatePayload): void;
  onError(payload: ClientInteractionTimeoutErrorPayload): void;
};

/**
 * Browser-facing adapter for stable interaction-timeout realtime events.
 * UI code receives semantic timeout callbacks instead of inspecting protocol
 * envelopes or subscribing to raw Socket.IO timeout event names.
 */
export function attachBrowserInteractionTimeoutEvents(
  session: BrowserInteractionTimeoutEventSource,
  handlers: BrowserInteractionTimeoutHandlers,
): () => void {
  return session.subscribeRealtimeEvents(event => {
    if (event.type === CLIENT_INTERACTION_TIMEOUT_STATE) {
      handlers.onState(event.payload as ClientInteractionTimeoutStatePayload);
      return;
    }
    if (event.type === CLIENT_INTERACTION_TIMEOUT_ERROR) {
      handlers.onError(event.payload as ClientInteractionTimeoutErrorPayload);
    }
  });
}
