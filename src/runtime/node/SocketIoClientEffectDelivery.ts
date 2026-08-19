import type { Server } from "socket.io";
import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  createClientAudioCueEffectEvent,
  createClientVibrateEffectEvent,
} from "../../protocol/client/ClientEffects.js";
import { actingPlayerIds, type RuntimeRoom } from "./roomBridge.js";

export type ActionAlertEffectOptions = {
  resumed?: boolean;
  timeoutWarning?: boolean;
};

/**
 * Canonical Node/Socket.IO delivery boundary for transient client effects.
 *
 * E2.3 keeps legacy Socket.IO events only as compatibility deliveries. New Web
 * clients consume the stable `client:event` envelope through ClientSession.
 */
export function emitActionAlertEffects(
  io: Server,
  room: RuntimeRoom,
  options: ActionAlertEffectOptions = {},
): void {
  if (!room.game) return;

  const context = {
    actionId: room.game.actionId,
    phase: room.game.phase,
    ...(options.resumed === undefined ? {} : { resumed: options.resumed }),
    ...(options.timeoutWarning === undefined
      ? {}
      : { timeoutWarning: options.timeoutWarning }),
  };

  for (const playerId of actingPlayerIds(room)) {
    const player = room.players.find(item => item.id === playerId);
    if (!player?.socketId) continue;

    io.to(player.socketId).emit(
      "client:event",
      createClientVibrateEffectEvent([300, 150, 300], {
        reason: "action-alert",
        context,
      }),
    );

    // E2.3 compatibility only. Current Web does not consume this event.
    io.to(player.socketId).emit("player:action-alert", context);
  }
}

export function emitNightCompleteEffects(io: Server, room: RuntimeRoom): void {
  if (!room.game) return;
  const context = { actionId: room.game.actionId };

  io.to(room.id).emit(
    "client:event",
    createClientVibrateEffectEvent([160, 100, 160, 100, 500], {
      reason: "night-complete",
      context,
    }),
  );

  const host = room.players.find(player => player.isHost);
  if (host?.socketId) {
    io.to(host.socketId).emit(
      "client:event",
      createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE, {
        reason: "night-complete",
        context,
      }),
    );
  }

  // E2.3 compatibility only. Current Web does not consume this event.
  io.to(room.id).emit("game:night-complete", context);
}

export function emitGameOverEffects(io: Server, room: RuntimeRoom): void {
  const winner = room.game?.winner;
  if (!winner) return;
  const context = { winner };

  io.to(room.id).emit(
    "client:event",
    createClientVibrateEffectEvent([500, 200, 500, 200, 500], {
      reason: "game-over",
      context,
    }),
  );

  // E2.3 compatibility only. Current Web does not consume this event.
  io.to(room.id).emit("game:over", context);
}
