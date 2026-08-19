import { ClientSession } from "../runtime/ClientSession.js";
import {
  SocketIoRealtimeTransport,
  type BrowserSocketIoLike,
  type SocketIoRealtimeTransportOptions,
} from "./SocketIoRealtimeTransport.js";

/**
 * Browser composition root for E2.2. Keeping this factory outside app.js means
 * the UI does not construct or understand FSM/store/transport internals.
 */
export function createWebClientSession<TStatePayload = unknown>(
  socket: BrowserSocketIoLike,
  options: SocketIoRealtimeTransportOptions = {},
): ClientSession<TStatePayload> {
  return new ClientSession<TStatePayload>(
    new SocketIoRealtimeTransport<TStatePayload>(socket, options),
  );
}

export { SocketIoRealtimeTransport } from "./SocketIoRealtimeTransport.js";
