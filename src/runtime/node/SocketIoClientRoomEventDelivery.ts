import type { Server, Socket } from "socket.io";
import {
  createClientRoomClosedEvent,
  createClientRoomRemovedEvent,
} from "../../protocol/client/ClientRoomEvents.js";

/**
 * Canonical Node/Socket.IO delivery boundary for transient room lifecycle
 * events. Stable clients consume these envelopes through `client:event`.
 */
export function emitClientRoomRemoved(socket: Socket, roomId: string): void {
  socket.emit("client:event", createClientRoomRemovedEvent(roomId));
}

export function emitClientRoomClosed(io: Server, roomId: string): void {
  io.to(roomId).emit("client:event", createClientRoomClosedEvent(roomId));
}
