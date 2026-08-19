import {
  CLIENT_PROTOCOL_VERSION,
  type ClientProtocolVersion,
  type ClientRealtimeEventEnvelope,
  type ClientStateEnvelope,
} from "./ClientProtocol.js";
import type { WerewolfClientCommandEnvelope } from "./werewolf/WerewolfClientProtocol.js";

export type ClientRawWebSocketSyncRequest = {
  protocolVersion: ClientProtocolVersion;
  kind: "request";
  requestId: string;
  type: "client:sync-state";
  payload: Record<string, never>;
};

export type ClientRawWebSocketCommandRequest = {
  protocolVersion: ClientProtocolVersion;
  kind: "request";
  requestId: string;
  type: "client:command";
  payload: WerewolfClientCommandEnvelope;
};

export type ClientRawWebSocketRequest =
  | ClientRawWebSocketSyncRequest
  | ClientRawWebSocketCommandRequest;

export type ClientRawWebSocketSuccessResponse<TPayload = unknown> = {
  protocolVersion: ClientProtocolVersion;
  kind: "response";
  requestId: string;
  ok: true;
  payload: TPayload;
};

export type ClientRawWebSocketErrorResponse = {
  protocolVersion: ClientProtocolVersion;
  kind: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message?: string;
  };
};

export type ClientRawWebSocketResponse<TPayload = unknown> =
  | ClientRawWebSocketSuccessResponse<TPayload>
  | ClientRawWebSocketErrorResponse;

export type ClientRawWebSocketStatePush<TPayload = unknown> = {
  protocolVersion: ClientProtocolVersion;
  kind: "push";
  type: "client:state";
  payload: {
    revision: number;
    envelope: ClientStateEnvelope<TPayload>;
  };
};

export type ClientRawWebSocketEventPush = {
  protocolVersion: ClientProtocolVersion;
  kind: "push";
  type: "client:event";
  payload: ClientRealtimeEventEnvelope;
};

export type ClientRawWebSocketPush<TStatePayload = unknown> =
  | ClientRawWebSocketStatePush<TStatePayload>
  | ClientRawWebSocketEventPush;

function requireRequestId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("raw WebSocket requestId is required");
  }
  return value.trim();
}

export function parseClientRawWebSocketRequest(value: unknown): ClientRawWebSocketRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("raw WebSocket request must be an object");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.protocolVersion !== CLIENT_PROTOCOL_VERSION || candidate.kind !== "request") {
    throw new Error("raw WebSocket request envelope is invalid");
  }

  const requestId = requireRequestId(candidate.requestId);
  if (candidate.type === "client:sync-state") {
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId,
      type: "client:sync-state",
      payload: {},
    };
  }

  if (candidate.type === "client:command") {
    if (!candidate.payload || typeof candidate.payload !== "object" || Array.isArray(candidate.payload)) {
      throw new Error("raw WebSocket client:command payload is invalid");
    }
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId,
      type: "client:command",
      payload: candidate.payload as WerewolfClientCommandEnvelope,
    };
  }

  throw new Error("raw WebSocket request type is unsupported");
}

export function createClientRawWebSocketSuccessResponse<TPayload>(
  requestId: string,
  payload: TPayload,
): ClientRawWebSocketSuccessResponse<TPayload> {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "response",
    requestId: requireRequestId(requestId),
    ok: true,
    payload,
  };
}

export function createClientRawWebSocketErrorResponse(
  requestId: string,
  code: string,
  message?: string,
): ClientRawWebSocketErrorResponse {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "response",
    requestId: requireRequestId(requestId),
    ok: false,
    error: {
      code,
      ...(message ? { message } : {}),
    },
  };
}

export function createClientRawWebSocketStatePush<TPayload>(
  revision: number,
  envelope: ClientStateEnvelope<TPayload>,
): ClientRawWebSocketStatePush<TPayload> {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("raw WebSocket state revision is invalid");
  }
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "push",
    type: "client:state",
    payload: { revision, envelope },
  };
}
