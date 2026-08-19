import type { Server } from "socket.io";
import { createNodePlayerStateEnvelope } from "./NodeClientProtocolAdapter.js";
import {
  advanceNodeClientStateRevision,
  currentNodeClientStateRevision,
} from "./NodeClientStateRevision.js";
import type { RuntimeRoom } from "./roomBridge.js";

export type ClientStateDelivery = {
  revision: number;
  envelope: ReturnType<typeof createNodePlayerStateEnvelope>;
};

export function currentClientStateDelivery(
  room: RuntimeRoom,
  playerId: string,
): ClientStateDelivery {
  return {
    revision: currentNodeClientStateRevision(room, playerId),
    envelope: createNodePlayerStateEnvelope(room, playerId),
  };
}

/**
 * Canonical Node/Socket.IO delivery boundary for private authoritative PlayerView.
 * Stable clients consume `client:state` exclusively.
 */
export function emitPrivatePlayerState(
  io: Server,
  room: RuntimeRoom,
  playerId: string,
): void {
  const player = room.players.find(item => item.id === playerId);
  if (!player?.socketId) return;

  const socket = io.sockets.sockets.get(player.socketId);
  if (!socket) return;

  const envelope = createNodePlayerStateEnvelope(room, playerId);
  const delivery = {
    revision: advanceNodeClientStateRevision(room, playerId),
    envelope,
  } satisfies ClientStateDelivery;

  socket.emit("client:state", delivery);
}
