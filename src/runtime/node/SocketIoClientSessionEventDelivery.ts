import type { Socket } from "socket.io";
import {
  createClientSessionReplacedEvent,
  type ClientSessionReplacedPayload,
} from "../../protocol/client/ClientSessionEvents.js";

/**
 * Canonical Node/Socket.IO delivery boundary for transient session lifecycle
 * events. Stable clients consume these envelopes through `client:event`.
 */
export function emitClientSessionReplaced(
  socket: Socket,
  payload: ClientSessionReplacedPayload,
): void {
  socket.emit("client:event", createClientSessionReplacedEvent(payload));
}
