import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
  type ClientRealtimeEventEnvelope,
  type ClientStateEnvelope,
} from "./ClientProtocol.js";

export const CLIENT_RAW_WEBSOCKET_WIRE_VERSION = 1 as const;

export type ClientRawWebSocketWireVersion =
  typeof CLIENT_RAW_WEBSOCKET_WIRE_VERSION;

export type ClientRawWebSocketSyncRequest = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "request";
  requestId: string;
  operation: "sync";
};

export type ClientRawWebSocketCommandRequest = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "request";
  requestId: string;
  operation: "command";
  envelope: ClientCommandEnvelope;
};

export type ClientRawWebSocketRequest =
  | ClientRawWebSocketSyncRequest
  | ClientRawWebSocketCommandRequest;

export type ClientRawWebSocketSuccessResponse<TResult = unknown> = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "response";
  requestId: string;
  ok: true;
  result?: TResult;
};

export type ClientRawWebSocketFailureResponse = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message?: string;
  };
};

export type ClientRawWebSocketResponse<TResult = unknown> =
  | ClientRawWebSocketSuccessResponse<TResult>
  | ClientRawWebSocketFailureResponse;

export type ClientRawWebSocketStateFrame<TPayload = unknown> = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "state";
  revision: number;
  envelope: ClientStateEnvelope<TPayload>;
};

export type ClientRawWebSocketEventFrame<
  TType extends string = string,
  TPayload = unknown,
> = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "event";
  envelope: ClientRealtimeEventEnvelope<TType, TPayload>;
};

export type ClientRawWebSocketProtocolErrorFrame = {
  wireVersion: ClientRawWebSocketWireVersion;
  kind: "error";
  code: string;
  requestId?: string;
  message?: string;
};

export type ClientRawWebSocketServerFrame =
  | ClientRawWebSocketResponse
  | ClientRawWebSocketStateFrame
  | ClientRawWebSocketEventFrame
  | ClientRawWebSocketProtocolErrorFrame;

export class ClientRawWebSocketWireError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ClientRawWebSocketWireError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function optionalRequestId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requestId(value: unknown): string {
  return nonEmptyString(value, "requestId");
}

function assertWireVersion(
  record: Record<string, unknown>,
  correlationId?: string,
): void {
  if (record.wireVersion !== CLIENT_RAW_WEBSOCKET_WIRE_VERSION) {
    throw new ClientRawWebSocketWireError(
      "unsupported_wire_version",
      "unsupported Raw WebSocket wire version",
      correlationId,
    );
  }
}

function parseCommandEnvelope(value: unknown): ClientCommandEnvelope {
  const record = asRecord(value);
  if (!record) throw new Error("command envelope is required");
  if (record.protocolVersion !== CLIENT_PROTOCOL_VERSION) {
    throw new Error("unsupported client protocol version");
  }
  if (record.kind !== "command") {
    throw new Error("client protocol message is not a command");
  }
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "command",
    commandId: nonEmptyString(record.commandId, "commandId"),
    type: nonEmptyString(record.type, "command type"),
    payload: record.payload,
  };
}

function parseStateEnvelope(value: unknown): ClientStateEnvelope {
  const record = asRecord(value);
  if (!record) throw new Error("state envelope is required");
  if (record.protocolVersion !== CLIENT_PROTOCOL_VERSION) {
    throw new Error("unsupported client protocol version");
  }
  if (record.kind !== "state") throw new Error("client protocol message is not state");
  if (record.scope !== "room" && record.scope !== "player") {
    throw new Error("state scope is invalid");
  }

  const roomId = nonEmptyString(record.roomId, "roomId");
  if (record.scope === "player") {
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "state",
      scope: "player",
      roomId,
      playerId: nonEmptyString(record.playerId, "playerId"),
      payload: record.payload,
    };
  }

  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "state",
    scope: "room",
    roomId,
    payload: record.payload,
  };
}

function parseEventEnvelope(value: unknown): ClientRealtimeEventEnvelope {
  const record = asRecord(value);
  if (!record) throw new Error("event envelope is required");
  if (record.protocolVersion !== CLIENT_PROTOCOL_VERSION) {
    throw new Error("unsupported client protocol version");
  }
  if (record.kind !== "event") throw new Error("client protocol message is not event");
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "event",
    type: nonEmptyString(record.type, "event type"),
    payload: record.payload,
  };
}

function assertRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("state revision is invalid");
  }
  return Number(value);
}

export function createClientRawWebSocketSyncRequest(
  correlationId: string,
): ClientRawWebSocketSyncRequest {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "request",
    requestId: requestId(correlationId),
    operation: "sync",
  };
}

export function createClientRawWebSocketCommandRequest(
  correlationId: string,
  envelope: ClientCommandEnvelope,
): ClientRawWebSocketCommandRequest {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "request",
    requestId: requestId(correlationId),
    operation: "command",
    envelope: parseCommandEnvelope(envelope),
  };
}

export function parseClientRawWebSocketRequest(
  value: unknown,
): ClientRawWebSocketRequest {
  const record = asRecord(value);
  if (!record) {
    throw new ClientRawWebSocketWireError(
      "invalid_request",
      "Raw WebSocket request must be an object",
    );
  }

  const correlationId = optionalRequestId(record.requestId);
  assertWireVersion(record, correlationId);

  if (record.kind !== "request") {
    throw new ClientRawWebSocketWireError(
      "invalid_request",
      "Raw WebSocket frame is not a request",
      correlationId,
    );
  }

  let normalizedRequestId: string;
  try {
    normalizedRequestId = requestId(record.requestId);
  } catch (error) {
    throw new ClientRawWebSocketWireError(
      "invalid_request",
      error instanceof Error ? error.message : "invalid requestId",
      correlationId,
    );
  }

  if (record.operation === "sync") {
    return createClientRawWebSocketSyncRequest(normalizedRequestId);
  }

  if (record.operation === "command") {
    try {
      return createClientRawWebSocketCommandRequest(
        normalizedRequestId,
        parseCommandEnvelope(record.envelope),
      );
    } catch (error) {
      throw new ClientRawWebSocketWireError(
        "invalid_request",
        error instanceof Error ? error.message : "invalid command request",
        normalizedRequestId,
      );
    }
  }

  throw new ClientRawWebSocketWireError(
    "invalid_request",
    "unsupported Raw WebSocket request operation",
    normalizedRequestId,
  );
}

export function createClientRawWebSocketSuccessResponse<TResult>(
  correlationId: string,
  result?: TResult,
): ClientRawWebSocketSuccessResponse<TResult> {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "response",
    requestId: requestId(correlationId),
    ok: true,
    ...(result === undefined ? {} : { result }),
  };
}

export function createClientRawWebSocketFailureResponse(
  correlationId: string,
  code: string,
  message?: string,
): ClientRawWebSocketFailureResponse {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "response",
    requestId: requestId(correlationId),
    ok: false,
    error: {
      code: nonEmptyString(code, "error code"),
      ...(message?.trim() ? { message: message.trim() } : {}),
    },
  };
}

export function createClientRawWebSocketStateFrame<TPayload>(
  revision: number,
  envelope: ClientStateEnvelope<TPayload>,
): ClientRawWebSocketStateFrame<TPayload> {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "state",
    revision: assertRevision(revision),
    envelope: parseStateEnvelope(envelope) as ClientStateEnvelope<TPayload>,
  };
}

export function createClientRawWebSocketEventFrame<
  TType extends string,
  TPayload,
>(
  envelope: ClientRealtimeEventEnvelope<TType, TPayload>,
): ClientRawWebSocketEventFrame<TType, TPayload> {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "event",
    envelope: parseEventEnvelope(envelope) as ClientRealtimeEventEnvelope<TType, TPayload>,
  };
}

export function createClientRawWebSocketProtocolErrorFrame(
  code: string,
  options: { requestId?: string; message?: string } = {},
): ClientRawWebSocketProtocolErrorFrame {
  return {
    wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
    kind: "error",
    code: nonEmptyString(code, "error code"),
    ...(options.requestId ? { requestId: requestId(options.requestId) } : {}),
    ...(options.message?.trim() ? { message: options.message.trim() } : {}),
  };
}

export function parseClientRawWebSocketServerFrame(
  value: unknown,
): ClientRawWebSocketServerFrame {
  const record = asRecord(value);
  if (!record) throw new Error("Raw WebSocket server frame must be an object");
  assertWireVersion(record, optionalRequestId(record.requestId));

  switch (record.kind) {
    case "response": {
      const correlationId = requestId(record.requestId);
      if (record.ok === true) {
        return createClientRawWebSocketSuccessResponse(correlationId, record.result);
      }
      if (record.ok === false) {
        const error = asRecord(record.error);
        if (!error) throw new Error("Raw WebSocket failure response is invalid");
        return createClientRawWebSocketFailureResponse(
          correlationId,
          nonEmptyString(error.code, "error code"),
          typeof error.message === "string" ? error.message : undefined,
        );
      }
      throw new Error("Raw WebSocket response ok flag is invalid");
    }

    case "state":
      return createClientRawWebSocketStateFrame(
        assertRevision(record.revision),
        parseStateEnvelope(record.envelope),
      );

    case "event":
      return createClientRawWebSocketEventFrame(parseEventEnvelope(record.envelope));

    case "error":
      return createClientRawWebSocketProtocolErrorFrame(
        nonEmptyString(record.code, "error code"),
        {
          ...(optionalRequestId(record.requestId)
            ? { requestId: optionalRequestId(record.requestId)! }
            : {}),
          ...(typeof record.message === "string" ? { message: record.message } : {}),
        },
      );

    default:
      throw new Error("unsupported Raw WebSocket server frame kind");
  }
}

export function encodeClientRawWebSocketFrame(
  frame: ClientRawWebSocketRequest | ClientRawWebSocketServerFrame,
): string {
  return JSON.stringify(frame);
}
