import type { ClientRoomProjection } from "../../protocol/client/ClientRoomProjection.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
  type ClientStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketCommandRequest,
  createClientRawWebSocketSyncRequest,
  encodeClientRawWebSocketFrame,
  parseClientRawWebSocketServerFrame,
  type ClientRawWebSocketRequest,
  type ClientRawWebSocketResponse,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import type { ClientConnectionFailure } from "./ClientConnectionFSM.js";
import {
  ClientTransportRequestError,
  type ClientAuthoritativeStateDelivery,
  type ClientRealtimeTransportListener,
} from "./ClientRealtimeTransport.js";

export type RawWebSocketTextSender = (data: string) => Promise<void>;

export type RawWebSocketClientTransportCoreOptions = {
  transportLabel?: string;
  requestIdPrefix?: string;
  requestIdFactory?: () => string;
  requestTimeoutMs?: number;
  commandRetries?: number;
};

type PendingRequest = {
  generation: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type SyncResponse<TPayload> = {
  revision: number;
  envelope: ClientStateEnvelope<TPayload>;
  roomEnvelope: ClientStateEnvelope<ClientRoomProjection>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : undefined;
}

function parseRoomProjectionEnvelope(
  value: unknown,
): ClientStateEnvelope<ClientRoomProjection> {
  const envelope = asRecord(value);
  const payload = asRecord(envelope?.payload);
  const viewer = asRecord(payload?.viewer);
  const players = payload?.players;

  if (
    !envelope ||
    envelope.protocolVersion !== CLIENT_PROTOCOL_VERSION ||
    envelope.kind !== "state" ||
    envelope.scope !== "room" ||
    typeof envelope.roomId !== "string" ||
    !payload ||
    payload.roomId !== envelope.roomId ||
    typeof payload.gameType !== "string" ||
    !viewer ||
    typeof viewer.playerId !== "string" ||
    typeof viewer.isHost !== "boolean" ||
    !Array.isArray(players) ||
    typeof payload.gameStarted !== "boolean"
  ) {
    throw new Error("authoritative room state envelope is invalid");
  }

  for (const player of players) {
    const record = asRecord(player);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      !Number.isSafeInteger(record.seat) ||
      Number(record.seat) < 1 ||
      typeof record.isHost !== "boolean"
    ) {
      throw new Error("authoritative room state player is invalid");
    }
  }

  return envelope as ClientStateEnvelope<ClientRoomProjection>;
}

function parseSyncResult<TStatePayload>(
  value: unknown,
  credentials: ClientReconnectCredentials,
): SyncResponse<TStatePayload> {
  const record = asRecord(value);
  const envelope = asRecord(record?.envelope);
  if (!Number.isSafeInteger(record?.revision) || Number(record?.revision) < 0) {
    throw new Error("authoritative client state revision is invalid");
  }
  if (
    !envelope ||
    envelope.protocolVersion !== CLIENT_PROTOCOL_VERSION ||
    envelope.kind !== "state" ||
    envelope.scope !== "player" ||
    envelope.roomId !== credentials.roomId ||
    envelope.playerId !== credentials.playerId
  ) {
    throw new Error("authoritative client state envelope is invalid");
  }

  const roomEnvelope = parseRoomProjectionEnvelope(record?.roomEnvelope);
  if (
    roomEnvelope.roomId !== credentials.roomId ||
    roomEnvelope.payload.viewer.playerId !== credentials.playerId
  ) {
    throw new Error("authoritative room state envelope is invalid");
  }

  return {
    revision: Number(record?.revision),
    envelope: envelope as ClientStateEnvelope<TStatePayload>,
    roomEnvelope,
  };
}

/**
 * Shared protocol/request engine for clients that speak the stable Raw WebSocket
 * wire contract. Platform adapters own ticket exchange, socket construction and
 * callback binding; this core owns correlation, retry, generation fencing and
 * transport-neutral authoritative/event frame dispatch.
 */
export class RawWebSocketClientTransportCore<TStatePayload = unknown> {
  private listener: ClientRealtimeTransportListener<TStatePayload> | null = null;
  private readonly transportLabel: string;
  private readonly requestIdPrefix: string;
  private readonly requestIdFactory: () => string;
  private requestSequence = 0;
  private readonly requestTimeoutMs: number;
  private readonly commandRetries: number;
  private activeGeneration = 0;
  private sender: RawWebSocketTextSender | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: RawWebSocketClientTransportCoreOptions = {}) {
    this.transportLabel = options.transportLabel?.trim() || "Raw WebSocket";
    this.requestIdPrefix = options.requestIdPrefix?.trim() || "raw-ws";
    this.requestIdFactory = options.requestIdFactory ??
      (() => `${this.requestIdPrefix}-${++this.requestSequence}`);
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1, Number(options.requestTimeoutMs))
      : 5000;
    this.commandRetries = Number.isInteger(options.commandRetries)
      ? Math.max(0, Number(options.commandRetries))
      : 1;
  }

  setListener(listener: ClientRealtimeTransportListener<TStatePayload>): void {
    this.listener = listener;
  }

  getActiveGeneration(): number {
    return this.activeGeneration;
  }

  isActiveGeneration(generation: number): boolean {
    return generation > 0 && generation === this.activeGeneration;
  }

  beginGeneration(generation: number): number {
    const previousGeneration = this.activeGeneration;
    if (previousGeneration > 0 && previousGeneration !== generation) {
      this.rejectPendingGeneration(
        previousGeneration,
        new ClientTransportRequestError(
          "transport-replaced",
          `${this.transportLabel} realtime transport generation was replaced`,
          true,
        ),
      );
    }

    this.activeGeneration = generation;
    this.sender = null;
    return previousGeneration;
  }

  open(generation: number, sender: RawWebSocketTextSender): boolean {
    if (!this.isActiveGeneration(generation)) return false;
    this.sender = sender;
    this.listener?.onOpen(generation);
    return true;
  }

  handleSocketClose(generation: number, reason?: string): boolean {
    if (!this.isActiveGeneration(generation)) return false;
    const normalizedReason = reason?.trim();
    this.sender = null;
    this.rejectPendingGeneration(
      generation,
      new ClientTransportRequestError(
        "transport-closed",
        normalizedReason || `${this.transportLabel} WebSocket closed`,
        true,
      ),
    );
    this.listener?.onClose(generation, normalizedReason || undefined);
    return true;
  }

  handleSocketError(generation: number, reason: string): boolean {
    if (!this.isActiveGeneration(generation)) return false;
    const normalizedReason = reason.trim() || `${this.transportLabel} WebSocket error`;
    this.sender = null;
    this.rejectPendingGeneration(
      generation,
      new ClientTransportRequestError("websocket-error", normalizedReason, true),
    );
    this.listener?.onClose(generation, normalizedReason);
    return true;
  }

  disconnect(generation: number): boolean {
    if (!this.isActiveGeneration(generation)) return false;
    this.sender = null;
    this.activeGeneration = 0;
    this.rejectPendingGeneration(
      generation,
      new ClientTransportRequestError(
        "transport-disconnected",
        `${this.transportLabel} realtime transport disconnected`,
        true,
      ),
    );
    return true;
  }

  reportError(generation: number, failure: ClientConnectionFailure): void {
    if (!this.isActiveGeneration(generation)) return;
    this.listener?.onError(generation, failure);
  }

  async synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<TStatePayload>> {
    this.assertActiveGeneration(generation);
    const result = await this.sendRequest(
      createClientRawWebSocketSyncRequest(this.nextRequestId()),
      generation,
    );
    const parsed = parseSyncResult<TStatePayload>(result, credentials);
    this.listener?.onRoomState?.({
      generation,
      revision: parsed.revision,
      envelope: parsed.roomEnvelope,
    });
    return {
      generation,
      revision: parsed.revision,
      envelope: parsed.envelope,
    };
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    if (message.kind !== "command") {
      return Promise.reject(
        new Error(
          `${this.transportLabel} client transport cannot send ${message.kind} messages`,
        ),
      );
    }

    const generation = this.activeGeneration;
    try {
      this.assertActiveGeneration(generation);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.sendCommandWithRetry(message, generation);
  }

  handleMessage(data: string | ArrayBuffer, generation: number): void {
    if (!this.isActiveGeneration(generation)) return;
    if (typeof data !== "string") {
      this.listener?.onError(generation, {
        code: "invalid-raw-websocket-frame",
        message: "binary server frames are not supported",
      });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data);
    } catch {
      this.listener?.onError(generation, {
        code: "invalid-raw-websocket-frame",
        message: "server frame is not valid JSON",
      });
      return;
    }

    let frame;
    try {
      frame = parseClientRawWebSocketServerFrame(parsedJson);
    } catch (error) {
      this.listener?.onError(generation, {
        code: "invalid-raw-websocket-frame",
        ...(errorMessage(error) ? { message: errorMessage(error)! } : {}),
      });
      return;
    }

    switch (frame.kind) {
      case "response":
        this.resolveResponse(frame, generation);
        return;

      case "state":
        if (frame.envelope.scope === "room") {
          try {
            this.listener?.onRoomState?.({
              generation,
              revision: frame.revision,
              envelope: parseRoomProjectionEnvelope(frame.envelope),
            });
          } catch (error) {
            this.listener?.onError(generation, {
              code: "invalid-authoritative-room-state",
              ...(errorMessage(error) ? { message: errorMessage(error)! } : {}),
            });
          }
          return;
        }
        if (frame.envelope.scope !== "player") {
          this.listener?.onError(generation, {
            code: "invalid-authoritative-state",
            message:
              `${this.transportLabel} transport received unsupported authoritative state`,
          });
          return;
        }
        this.listener?.onState({
          generation,
          revision: frame.revision,
          envelope: frame.envelope as ClientStateEnvelope<TStatePayload>,
        });
        return;

      case "event":
        this.listener?.onEvent({
          generation,
          envelope: frame.envelope,
        });
        return;

      case "error": {
        const pending = frame.requestId
          ? this.takePending(frame.requestId, generation)
          : undefined;
        if (pending) {
          pending.reject(new Error(frame.message || frame.code));
          return;
        }
        this.listener?.onError(generation, {
          code: frame.code,
          ...(frame.message ? { message: frame.message } : {}),
        });
        return;
      }
    }
  }

  private async sendCommandWithRetry(
    message: Extract<ClientProtocolMessage, { kind: "command" }>,
    generation: number,
  ): Promise<unknown> {
    let retries = 0;
    let previousRequestId: string | null = null;

    while (true) {
      const requestId = this.nextRequestId();
      if (previousRequestId === requestId) {
        throw new Error(
          `${this.transportLabel} command retry must use a new requestId`,
        );
      }
      previousRequestId = requestId;

      try {
        return await this.sendRequest(
          createClientRawWebSocketCommandRequest(requestId, message),
          generation,
        );
      } catch (error) {
        const retryable = error instanceof ClientTransportRequestError &&
          error.retryable &&
          this.isActiveGeneration(generation) &&
          this.sender !== null;

        if (!retryable || retries >= this.commandRetries) throw error;
        retries += 1;
      }
    }
  }

  private resolveResponse(
    frame: ClientRawWebSocketResponse,
    generation: number,
  ): void {
    const pending = this.takePending(frame.requestId, generation);
    if (!pending) return;

    if (frame.ok) {
      pending.resolve(frame.result);
      return;
    }
    pending.reject(new Error(frame.error.message || frame.error.code));
  }

  private sendRequest(
    request: ClientRawWebSocketRequest,
    generation: number,
  ): Promise<unknown> {
    try {
      this.assertActiveGeneration(generation);
    } catch (error) {
      return Promise.reject(error);
    }

    const sender = this.sender;
    if (!sender) {
      return Promise.reject(
        new Error(`${this.transportLabel} WebSocket is not open`),
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const pending = this.takePending(request.requestId, generation);
        if (!pending) return;
        pending.reject(new ClientTransportRequestError(
          "request-timeout",
          `${this.transportLabel} realtime request timed out`,
          true,
        ));
      }, this.requestTimeoutMs);

      this.pending.set(request.requestId, {
        generation,
        timeoutHandle,
        resolve,
        reject,
      });

      let sendPromise: Promise<void>;
      try {
        sendPromise = sender(encodeClientRawWebSocketFrame(request));
      } catch (error) {
        this.rejectSendFailure(request.requestId, generation, error);
        return;
      }

      void sendPromise.catch(error => {
        this.rejectSendFailure(request.requestId, generation, error);
      });
    });
  }

  private rejectSendFailure(
    requestId: string,
    generation: number,
    error: unknown,
  ): void {
    const pending = this.takePending(requestId, generation);
    if (!pending) return;
    pending.reject(new ClientTransportRequestError(
      "send-failed",
      errorMessage(error) || `${this.transportLabel} WebSocket send failed`,
      true,
    ));
  }

  private nextRequestId(): string {
    const value = this.requestIdFactory().trim();
    if (!value) {
      throw new Error(
        `${this.transportLabel} requestId factory returned an empty value`,
      );
    }
    if (this.pending.has(value)) {
      throw new Error(`duplicate ${this.transportLabel} requestId: ${value}`);
    }
    return value;
  }

  private assertActiveGeneration(generation: number): void {
    if (!this.isActiveGeneration(generation)) {
      throw new Error(
        `stale ${this.transportLabel} realtime transport generation`,
      );
    }
  }

  private takePending(
    requestId: string,
    generation: number,
  ): PendingRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending || pending.generation !== generation) return undefined;
    this.pending.delete(requestId);
    clearTimeout(pending.timeoutHandle);
    return pending;
  }

  private rejectPendingGeneration(generation: number, error: Error): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.generation !== generation) continue;
      this.pending.delete(requestId);
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  }
}
