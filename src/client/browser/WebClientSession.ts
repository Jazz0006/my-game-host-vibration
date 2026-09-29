import { ClientSession } from "../runtime/ClientSession.js";
import { attachBrowserClientEffects } from "./BrowserClientEffects.js";
import {
  CloudflareRealtimeTransport,
  type CloudflareRealtimeTransportOptions,
} from "./CloudflareRealtimeTransport.js";
import {
  SocketIoRealtimeTransport,
  type BrowserSocketIoLike,
  type SocketIoRealtimeTransportOptions,
} from "./SocketIoRealtimeTransport.js";

/**
 * Browser composition root for E2.2. Keeping this factory outside app.js means
 * the UI does not construct or understand FSM/store/transport/effect internals.
 */
export function createWebClientSession<TStatePayload = unknown>(
  socket: BrowserSocketIoLike,
  options: SocketIoRealtimeTransportOptions = {},
): ClientSession<TStatePayload> {
  const session = new ClientSession<TStatePayload>(
    new SocketIoRealtimeTransport<TStatePayload>(socket, options),
  );
  attachBrowserClientEffects(session);
  return session;
}

/**
 * Cloudflare-authoritative browser composition root for W3. This is deliberately
 * separate from createWebClientSession until the production Web UI has migrated
 * every authority-dependent room/recovery surface away from the Node room.
 */
export function createCloudflareWebClientSession<TStatePayload = unknown>(
  options: CloudflareRealtimeTransportOptions,
): ClientSession<TStatePayload> {
  const session = new ClientSession<TStatePayload>(
    new CloudflareRealtimeTransport<TStatePayload>(options),
  );
  attachBrowserClientEffects(session);
  return session;
}

export { attachBrowserClientEffects } from "./BrowserClientEffects.js";
export { attachBrowserInteractionTimeoutEvents } from "./BrowserInteractionTimeoutEvents.js";
export { attachBrowserSessionLifecycle } from "./BrowserSessionLifecycle.js";
export { attachBrowserRoomLifecycle } from "./BrowserSessionEvents.js";
export { attachBrowserSessionReplaced } from "./BrowserSessionEvents.js";
export { BrowserRoomBootstrapClient } from "./BrowserRoomBootstrapClient.js";
export { CloudflareRealtimeTransport } from "./CloudflareRealtimeTransport.js";
export { SocketIoRealtimeTransport } from "./SocketIoRealtimeTransport.js";
