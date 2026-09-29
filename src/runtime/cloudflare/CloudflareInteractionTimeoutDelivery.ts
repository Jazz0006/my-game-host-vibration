import {
  createClientActionAlertEffectEvent,
} from "../../protocol/client/ClientEffects.js";
import {
  createClientInteractionTimeoutErrorEvent,
  createClientInteractionTimeoutStateEvent,
} from "../../protocol/client/ClientInteractionTimeoutEvents.js";
import {
  createClientRawWebSocketEventFrame,
  encodeClientRawWebSocketFrame,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  MAX_INTERACTION_TIMEOUT_EXTENSIONS,
  type InteractionTimeoutState,
} from "../shared/interactionTimeoutPolicy.js";
import type { CloudflareRoomRealtime } from "./CloudflareRoomRealtime.js";

function encodeEvent(envelope: Parameters<typeof createClientRawWebSocketEventFrame>[0]): string {
  return encodeClientRawWebSocketFrame(
    createClientRawWebSocketEventFrame(envelope),
  );
}

function sendToPlayers(
  realtime: CloudflareRoomRealtime,
  playerIds: readonly string[],
  encoded: string,
): number {
  let delivered = 0;
  for (const playerId of playerIds) {
    delivered += realtime.sendToPlayer(playerId, encoded);
  }
  return delivered;
}

export function emitCloudflareInteractionTimeoutActive(
  realtime: CloudflareRoomRealtime,
  state: InteractionTimeoutState,
  warning = false,
): number {
  return sendToPlayers(
    realtime,
    state.actorPlayerIds,
    encodeEvent(
      createClientInteractionTimeoutStateEvent({
        roomId: state.roomId,
        active: true,
        actionId: state.actionId,
        deadlineAt: state.deadlineAt,
        warningAt: state.warningAt,
        warning,
        canExtend:
          state.extensionCount < MAX_INTERACTION_TIMEOUT_EXTENSIONS,
        extensionCount: state.extensionCount,
      }),
    ),
  );
}

export function emitCloudflareInteractionTimeoutInactive(
  realtime: CloudflareRoomRealtime,
  state: InteractionTimeoutState,
): number {
  return sendToPlayers(
    realtime,
    state.actorPlayerIds,
    encodeEvent(
      createClientInteractionTimeoutStateEvent({
        roomId: state.roomId,
        active: false,
        actionId: state.actionId,
      }),
    ),
  );
}

export function emitCloudflareInteractionTimeoutError(
  realtime: CloudflareRoomRealtime,
  state: InteractionTimeoutState,
  message: string,
): number {
  return sendToPlayers(
    realtime,
    state.actorPlayerIds,
    encodeEvent(
      createClientInteractionTimeoutErrorEvent({
        roomId: state.roomId,
        actionId: state.actionId,
        message,
      }),
    ),
  );
}

export function emitCloudflareActionAlertToPlayers(
  realtime: CloudflareRoomRealtime,
  playerIds: readonly string[],
  context: Record<string, unknown>,
): number {
  return sendToPlayers(
    realtime,
    playerIds,
    encodeEvent(createClientActionAlertEffectEvent(context)),
  );
}
