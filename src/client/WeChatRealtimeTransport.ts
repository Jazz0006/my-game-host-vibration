import {
  CLIENT_PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
  type ClientStateEnvelope,
} from "../protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketCommandRequest,
  createClientRawWebSocketSyncRequest,
  encodeClientRawWebSocketFrame,
  parseClientRawWebSocketServerFrame,
  type ClientRawWebSocketResponse,
} from "../protocol/client/ClientRawWebSocketProtocol.js";
import {
  ClientTransportRequestError,
  type ClientAuthoritativeStateDelivery,
  type ClientRealtimeTransport,
  type ClientRealtimeTransportListener,
} from "./runtime/ClientRealtimeTransport.js";

export type WeChatRequestResponse = {
  statusCode: number;
  data: unknown;
};

export type WeChatSocketTaskLike = {
  onOpen(listener: () => void): void;
  onClose(listener: (event: { code?: number; reason?: string }) => void): void;
  onError(listener: (error: unknown) => void): void;
  onMessage(listener: (event: { data: string | ArrayBuffer }) => void): void;
  send(options: {
    data: string | ArrayBuffer;
    success?: () => void;
    fail?: (error: unknown) => void;
  }): void;
  close(options?: { code?: number; reason?: string }): void;
};

export type WeChatPlatformLike = {
  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: WeChatRequestResponse): void;
    fail(error: unknown): void;
  }): void;
  connectSocket(options: { url: string }): WeChatSocketTaskLike;
};

export type WeChatRealtimeTransportOptions = {
  baseUrl: string;
  requestIdFactory?: () => string;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  generation: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type TicketResponse = {
  ok: true;
  ticket: string;
  expiresAt?: number;
};

type SyncResponse<TPayload> = {
  revision: number;
  envelope: ClientStateEnvelope<TPayload>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const record = asRecord(error);
  const errMsg = record?.errMsg;
  return typeof errMsg === "string" && errMsg.trim() ? errMsg.trim() : undefined;
}

function normalizedBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("WeChat realtime baseUrl must use http or https");
  }
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error("WeChat realtime baseUrl must not contain query or hash");
  }
  return normalized;
}

function roomResourceUrl(baseUrl: string, roomId: string, resource: string): string {
  return `${baseUrl}/rooms/${encodeURIComponent(roomId)}/${resource}`;
}

function websocketUrl(baseUrl: string, roomId: string, ticket: string): string {
  const httpUrl = roomResourceUrl(baseUrl, roomId, "websocket");
  const wsUrl = httpUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return `${wsUrl}?ticket=${encodeURIComponent(ticket)}`;
}

function parseTicketResponse(response: WeChatRequestResponse): TicketResponse {
  const record = asRecord(response.data);
  const message = typeof record?.message === "string" ? record.message.trim() : "";
  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    record?.ok !== true ||
    typeof record.ticket !== "string" ||
    !record.ticket.trim()
  ) {
    throw new Error(message || `WebSocket ticket request failed with status ${response.statusCode}`);
  }
  return {
    ok: true,
    ticket: record.ticket.trim(),
    ...(Number.isFinite(record.expiresAt) ? { expiresAt: Number(record.expiresAt) } : {}),
  };
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
  return {
    revision: Number(record?.revision),
    envelope: envelope as ClientStateEnvelope<TStatePayload>,
  };
}

/**
 * E3.2c native WeChat implementation of ClientRealtimeTransport.
 *
 * Current session credentials are used only to exchange a one-time Cloudflare
 * WebSocket ticket. Persistent storage, reconnect policy, lifecycle recovery,
 * and game behavior stay outside this adapter.
 */
export class WeChatRealtimeTransport<TStatePayload = unknown>
implements ClientRealtimeTransport<TStatePayload> {
  private listener: ClientRealtimeTransportListener<TStatePayload> | null = null;
  private readonly baseUrl: string;
  private readonly requestIdFactory: () => string;
  private requestSequence = 0;
  private readonly requestTimeoutMs: number;
  private activeGeneration = 0;
  private socket: WeChatSocketTaskLike | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly platform: WeChatPlatformLike,
    options: WeChatRealtimeTransportOptions,
  ) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.requestIdFactory = options.requestIdFactory ??
      (() => `wechat-${++this.requestSequence}`);
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1, Number(options.requestTimeoutMs))
      : 5000;
  }

  setListener(listener: ClientRealtimeTransportListener<TStatePayload>): void {
    this.listener = listener;
  }

  connect(credentials: ClientReconnectCredentials, generation: number): void {
    const previousGeneration = this.activeGeneration;
    const previousSocket = this.socket;
    if (previousGeneration > 0 && previousGeneration !== generation) {
      this.rejectPendingGeneration(
        previousGeneration,
        new ClientTransportRequestError(
          "transport-replaced",
          "WeChat realtime transport generation was replaced",
          true,
        ),
      );
      previousSocket?.close({ code: 1000, reason: "connection generation replaced" });
    }

    this.activeGeneration = generation;
    this.socket = null;

    this.platform.request({
      url: roomResourceUrl(this.baseUrl, credentials.roomId, "websocket-ticket"),
      method: "POST",
      data: {
        playerId: credentials.playerId,
        resumeToken: credentials.resumeToken,
      },
      success: response => {
        if (generation !== this.activeGeneration) return;

        let ticket: TicketResponse;
        try {
          ticket = parseTicketResponse(response);
        } catch (error) {
          this.listener?.onError(generation, {
            code: "websocket-ticket-failed",
            ...(errorMessage(error) ? { message: errorMessage(error)! } : {}),
          });
          return;
        }

        let socket: WeChatSocketTaskLike;
        try {
          socket = this.platform.connectSocket({
            url: websocketUrl(this.baseUrl, credentials.roomId, ticket.ticket),
          });
        } catch (error) {
          this.listener?.onClose(
            generation,
            errorMessage(error) || "WeChat WebSocket connect failed",
          );
          return;
        }

        if (generation !== this.activeGeneration) {
          socket.close({ reason: "stale connection generation" });
          return;
        }

        this.socket = socket;
        this.bindSocket(socket, generation);
      },
      fail: error => {
        if (generation !== this.activeGeneration) return;
        this.listener?.onClose(
          generation,
          errorMessage(error) || "WeChat WebSocket ticket request failed",
        );
      },
    });
  }

  disconnect(generation: number): void {
    if (generation !== this.activeGeneration) return;
    const socket = this.socket;
    this.socket = null;
    this.activeGeneration = 0;
    this.rejectPendingGeneration(
      generation,
      new ClientTransportRequestError(
        "transport-disconnected",
        "WeChat realtime transport disconnected",
        true,
      ),
    );
    socket?.close({ code: 1000, reason: "client disconnect" });
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
    return {
      generation,
      revision: parsed.revision,
      envelope: parsed.envelope,
    };
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    if (message.kind !== "command") {
      return Promise.reject(
        new Error(`WeChat client transport cannot send ${message.kind} messages`),
      );
    }
    const generation = this.activeGeneration;
    try {
      this.assertActiveGeneration(generation);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.sendRequest(
      createClientRawWebSocketCommandRequest(this.nextRequestId(), message),
      generation,
    );
  }

  private bindSocket(socket: WeChatSocketTaskLike, generation: number): void {
    socket.onOpen(() => {
      if (!this.isActive(socket, generation)) return;
      this.listener?.onOpen(generation);
    });

    socket.onClose(event => {
      if (!this.isActive(socket, generation)) return;
      this.socket = null;
      this.rejectPendingGeneration(
        generation,
        new ClientTransportRequestError(
          "transport-closed",
          event.reason?.trim() || "WeChat WebSocket closed",
          true,
        ),
      );
      this.listener?.onClose(
        generation,
        event.reason?.trim() || undefined,
      );
    });

    socket.onError(error => {
      if (!this.isActive(socket, generation)) return;
      const reason = errorMessage(error) || "WeChat WebSocket error";
      this.socket = null;
      this.rejectPendingGeneration(
        generation,
        new ClientTransportRequestError("websocket-error", reason, true),
      );
      this.listener?.onClose(generation, reason);
      socket.close({ reason });
    });

    socket.onMessage(event => {
      if (!this.isActive(socket, generation)) return;
      this.handleMessage(event.data, generation);
    });
  }

  private handleMessage(data: string | ArrayBuffer, generation: number): void {
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
        if (frame.envelope.scope !== "player") {
          this.listener?.onError(generation, {
            code: "invalid-authoritative-state",
            message: "WeChat transport received non-player authoritative state",
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
    request: ReturnType<typeof createClientRawWebSocketSyncRequest> |
      ReturnType<typeof createClientRawWebSocketCommandRequest>,
    generation: number,
  ): Promise<unknown> {
    try {
      this.assertActiveGeneration(generation);
    } catch (error) {
      return Promise.reject(error);
    }
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("WeChat WebSocket is not open"));

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const pending = this.takePending(request.requestId, generation);
        if (!pending) return;
        pending.reject(new ClientTransportRequestError(
          "request-timeout",
          "WeChat realtime request timed out",
          true,
        ));
      }, this.requestTimeoutMs);

      this.pending.set(request.requestId, {
        generation,
        timeoutHandle,
        resolve,
        reject,
      });

      socket.send({
        data: encodeClientRawWebSocketFrame(request),
        success: () => {},
        fail: error => {
          const pending = this.takePending(request.requestId, generation);
          if (!pending) return;
          pending.reject(new ClientTransportRequestError(
            "send-failed",
            errorMessage(error) || "WeChat WebSocket send failed",
            true,
          ));
        },
      });
    });
  }

  private nextRequestId(): string {
    const value = this.requestIdFactory().trim();
    if (!value) throw new Error("WeChat requestId factory returned an empty value");
    if (this.pending.has(value)) {
      throw new Error(`duplicate WeChat requestId: ${value}`);
    }
    return value;
  }

  private assertActiveGeneration(generation: number): void {
    if (generation <= 0 || generation !== this.activeGeneration) {
      throw new Error("stale WeChat realtime transport generation");
    }
  }

  private isActive(socket: WeChatSocketTaskLike, generation: number): boolean {
    return generation === this.activeGeneration && socket === this.socket;
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
