import { requireCommandId } from "../../core/command/CommandEnvelope.js";

export const CLIENT_PROTOCOL_VERSION = 1 as const;

export type ClientProtocolVersion = typeof CLIENT_PROTOCOL_VERSION;

export type ClientCommandEnvelope<
  TType extends string = string,
  TPayload = unknown,
> = {
  protocolVersion: ClientProtocolVersion;
  kind: "command";
  commandId: string;
  type: TType;
  payload: TPayload;
};

export type ClientStateEnvelope<TPayload = unknown> = {
  protocolVersion: ClientProtocolVersion;
  kind: "state";
  scope: "room" | "player";
  roomId: string;
  playerId?: string;
  payload: TPayload;
};

export type ClientRealtimeEventEnvelope<
  TType extends string = string,
  TPayload = unknown,
> = {
  protocolVersion: ClientProtocolVersion;
  kind: "event";
  type: TType;
  payload: TPayload;
};

export type ClientReconnectCredentials = {
  roomId: string;
  playerId: string;
  resumeToken: string;
};

export type ClientReconnectEnvelope = {
  protocolVersion: ClientProtocolVersion;
  kind: "reconnect";
  credentials: ClientReconnectCredentials;
};

export type ClientProtocolMessage =
  | ClientCommandEnvelope
  | ClientStateEnvelope
  | ClientRealtimeEventEnvelope
  | ClientReconnectEnvelope;

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

export function createClientCommandEnvelope<
  TType extends string,
  TPayload,
>(
  type: TType,
  payload: TPayload,
  commandId: string,
): ClientCommandEnvelope<TType, TPayload> {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "command",
    commandId: requireCommandId(commandId),
    type: requireNonEmptyString(type, "command type") as TType,
    payload,
  };
}

export function createPlayerStateEnvelope<TPayload>(
  roomId: string,
  playerId: string,
  payload: TPayload,
): ClientStateEnvelope<TPayload> {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "state",
    scope: "player",
    roomId: requireNonEmptyString(roomId, "roomId"),
    playerId: requireNonEmptyString(playerId, "playerId"),
    payload,
  };
}

export function createRoomStateEnvelope<TPayload>(
  roomId: string,
  payload: TPayload,
): ClientStateEnvelope<TPayload> {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "state",
    scope: "room",
    roomId: requireNonEmptyString(roomId, "roomId"),
    payload,
  };
}

export function createReconnectEnvelope(
  credentials: ClientReconnectCredentials,
): ClientReconnectEnvelope {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "reconnect",
    credentials: {
      roomId: requireNonEmptyString(credentials.roomId, "roomId"),
      playerId: requireNonEmptyString(credentials.playerId, "playerId"),
      resumeToken: requireNonEmptyString(credentials.resumeToken, "resumeToken"),
    },
  };
}

/**
 * E1 transport contract. Payloads must be JSON-serializable at adapter
 * boundaries, but TypeScript payload types may naturally use optional fields.
 * Reconnect always returns authoritative state/view; protocol clients do not
 * replay a missed realtime-event history.
 */
export const CLIENT_RECONNECT_POLICY = {
  sourceOfTruth: "authoritative-state" as const,
  eventReplay: false as const,
};
