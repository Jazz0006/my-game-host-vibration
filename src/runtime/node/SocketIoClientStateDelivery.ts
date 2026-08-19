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
 *
 * Stable clients consume `client:state`. `player:game-state` remains a temporary
 * compatibility delivery until E2.3c2 migrates the remaining integration tests
 * and removes that retired wire event.
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

  // E2.3c1 compatibility only. Production Web consumes `client:state`.
  socket.emit("player:game-state", envelope.payload);
}
