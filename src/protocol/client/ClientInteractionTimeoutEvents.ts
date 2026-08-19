import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "./ClientProtocol.js";

export const CLIENT_INTERACTION_TIMEOUT_STATE = "interaction.timeout-state" as const;
export const CLIENT_INTERACTION_TIMEOUT_ERROR = "interaction.timeout-error" as const;

export type ClientInteractionTimeoutActivePayload = {
  roomId: string;
  active: true;
  actionId: string;
  deadlineAt: number;
  warningAt: number;
  warning: boolean;
  canExtend: boolean;
  extensionCount: number;
};

export type ClientInteractionTimeoutInactivePayload = {
  roomId: string;
  active: false;
  actionId: string;
};

export type ClientInteractionTimeoutStatePayload =
  | ClientInteractionTimeoutActivePayload
  | ClientInteractionTimeoutInactivePayload;

export type ClientInteractionTimeoutErrorPayload = {
  roomId: string;
  actionId: string;
  message: string;
};

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function requireTimestamp(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }
  return value;
}

function requireExtensionCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("extensionCount must be a non-negative safe integer");
  }
  return value;
}

export function createClientInteractionTimeoutStateEvent(
  payload: ClientInteractionTimeoutStatePayload,
): ClientRealtimeEventEnvelope<
  typeof CLIENT_INTERACTION_TIMEOUT_STATE,
  ClientInteractionTimeoutStatePayload
> {
  const roomId = requireNonEmptyString(payload.roomId, "roomId");
  const actionId = requireNonEmptyString(payload.actionId, "actionId");

  if (!payload.active) {
    return createClientRealtimeEventEnvelope(CLIENT_INTERACTION_TIMEOUT_STATE, {
      roomId,
      active: false,
      actionId,
    });
  }

  return createClientRealtimeEventEnvelope(CLIENT_INTERACTION_TIMEOUT_STATE, {
    roomId,
    active: true,
    actionId,
    deadlineAt: requireTimestamp(payload.deadlineAt, "deadlineAt"),
    warningAt: requireTimestamp(payload.warningAt, "warningAt"),
    warning: payload.warning,
    canExtend: payload.canExtend,
    extensionCount: requireExtensionCount(payload.extensionCount),
  });
}

export function createClientInteractionTimeoutErrorEvent(
  payload: ClientInteractionTimeoutErrorPayload,
): ClientRealtimeEventEnvelope<
  typeof CLIENT_INTERACTION_TIMEOUT_ERROR,
  ClientInteractionTimeoutErrorPayload
> {
  return createClientRealtimeEventEnvelope(CLIENT_INTERACTION_TIMEOUT_ERROR, {
    roomId: requireNonEmptyString(payload.roomId, "roomId"),
    actionId: requireNonEmptyString(payload.actionId, "actionId"),
    message: requireNonEmptyString(payload.message, "message"),
  });
}
