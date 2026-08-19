import { ClientSession } from "../runtime/ClientSession.js";
import { attachBrowserClientEffects } from "./BrowserClientEffects.js";
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

export { attachBrowserClientEffects } from "./BrowserClientEffects.js";
export { attachBrowserSessionLifecycle } from "./BrowserSessionLifecycle.js";
export { SocketIoRealtimeTransport } from "./SocketIoRealtimeTransport.js";
