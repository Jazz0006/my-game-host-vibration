import type { Server } from "socket.io";
import {
  createClientInteractionTimeoutErrorEvent,
  createClientInteractionTimeoutStateEvent,
  type ClientInteractionTimeoutStatePayload,
} from "../../protocol/client/ClientInteractionTimeoutEvents.js";
import type { InteractionTimeoutClientState } from "./InteractionTimeoutCoordinator.js";

function toStableTimeoutState(
  roomId: string,
  state: InteractionTimeoutClientState,
): ClientInteractionTimeoutStatePayload {
  const actionId = state.actionId?.trim();
  if (!actionId) throw new Error("timeout state actionId is required");

  if (!state.active) {
    return { roomId, active: false, actionId };
  }

  if (
    state.deadlineAt === undefined ||
    state.warningAt === undefined ||
    state.warning === undefined ||
    state.canExtend === undefined ||
    state.extensionCount === undefined
  ) {
    throw new Error("active timeout state is incomplete");
  }

  return {
    roomId,
    active: true,
    actionId,
    deadlineAt: state.deadlineAt,
    warningAt: state.warningAt,
    warning: state.warning,
    canExtend: state.canExtend,
    extensionCount: state.extensionCount,
  };
}

export function emitClientInteractionTimeoutState(
  io: Server,
  socketId: string,
  roomId: string,
  state: InteractionTimeoutClientState,
): void {
  io.to(socketId).emit(
    "client:event",
    createClientInteractionTimeoutStateEvent(toStableTimeoutState(roomId, state)),
  );
}

export function emitClientInteractionTimeoutError(
  io: Server,
  socketId: string,
  payload: { roomId: string; actionId: string; message: string },
): void {
  io.to(socketId).emit(
    "client:event",
    createClientInteractionTimeoutErrorEvent(payload),
  );
}
