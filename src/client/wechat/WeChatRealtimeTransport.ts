import {
  CLIENT_PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type ClientRealtimeEventEnvelope,
  type ClientReconnectCredentials,
  type ClientStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import type { ClientRawWebSocketResponse } from "../../protocol/client/ClientRawWebSocketProtocol.js";
import type {
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
  ClientRealtimeTransportListener,
} from "../runtime/ClientRealtimeTransport.js";

export type WeChatRequestSuccess = {
  statusCode: number;
  data: unknown;
};

export type WeChatRequestOptions = {
  url: string;
  method: "POST";
  data: unknown;
  header?: Record<string, string>;
  success(result: WeChatRequestSuccess): void;
  fail(error: unknown): void;
};

export type WeChatSocketTaskLike = {
  onOpen(listener: () => void): void;
  onClose(listener: (result?: { code?: number; reason?: string }) => void): void;
  onError(listener: (error: unknown) => void): void;
  onMessage(listener: (result: { data: unknown }) => void): void;
  send(options: {
    data: string;
    success?(): void;
    fail?(error: unknown): void;
  }): void;
  close(options?: { code?: number; reason?: string }): void;
};

export type WeChatRealtimePlatform = {
  request(options: WeChatRequestOptions): unknown;
  connectSocket(options: { url: string }): WeChatSocketTaskLike;
};

export type WeChatRealtimeTransportOptions = {
  baseUrl: string;
};

type PendingRequest = {
  generation: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type WebSocketTicketResponse = {
  ok: true;
  ticket: string;
  expiresAt: number;
};

function normalizedBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//u.test(trimmed)) {
    throw new Error("WeChat realtime baseUrl must use http or https");
  }
  return trimmed;
}

function socketBaseUrl(httpBaseUrl: string): string {
  return httpBaseUrl.startsWith("https://")
    ? `wss://${httpBaseUrl.slice("https://".length)}`
    : `ws://${httpBaseUrl.slice("http://".length)}`;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const errMsg = (error as { errMsg?: unknown }).errMsg;
    if (typeof errMsg === "string" && errMsg.trim()) return errMsg.trim();
  }
  return undefined;
}

function sameCredentials(
  actual: ClientReconnectCredentials,
  expected: ClientReconnectCredentials,
): boolean {
  return actual.roomId === expected.roomId &&
    actual.playerId === expected.playerId &&
    actual.resumeToken === expected.resumeToken;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStatePush<TStatePayload>(
  value: unknown,
  generation: number,
): ClientAuthoritativeStateDelivery<TStatePayload> {
  const frame = asRecord(value);
  const payload = asRecord(frame?.payload);
  const envelope = asRecord(payload?.envelope);
  const revision = payload?.revision;

  if (
    !frame ||
    frame.protocolVersion !== CLIENT_PROTOCOL_VERSION ||
    frame.kind !== "push" ||
    frame.type !== "client:state" ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 0 ||
    !envelope ||
    envelope.protocolVersion !== CLIENT_PROTOCOL_VERSION ||
    envelope.kind !== "state" ||
    envelope.scope !== "player" ||
    typeof envelope.roomId !== "string" ||
    typeof envelope.playerId !== "string"
  ) {
    throw new Error("raw WebSocket authoritative state push is invalid");
  }

  return {
    generation,
    revision: Number(revision),
    envelope: envelope as ClientStateEnvelope<TStatePayload>,
  };
}

/**
 * E3.2 minimal native WeChat implementation of ClientRealtimeTransport.
 *
 * The transport owns only Mini Program request/socket APIs and raw WebSocket
 * framing. ClientSession remains responsible for generation, connection FSM,
 * authoritative revision reconciliation, and reconnect semantics. Command retry
 * is intentionally deferred to E3.4.
 */
export class WeChatRealtimeTransport<TStatePayload = unknown>
implements ClientRealtimeTransport<TStatePayload> {
  private listener: ClientRealtimeTransportListener<TStatePayload> | null = null;
  private readonly baseUrl: string;
  private activeGeneration = 0;
  private socket: WeChatSocketTaskLike | null = null;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly platform: WeChatRealtimePlatform,
    private readonly credentials: ClientReconnectCredentials,
    options: WeChatRealtimeTransportOptions,
  ) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
  }

  setListener(listener: ClientRealtimeTransportListener<TStatePayload>): void {
    this.listener = listener;
  }

  connect(generation: number): void {
    this.activeGeneration = generation;
    this.socket?.close({ code: 1000, reason: "new generation" });
    this.socket = null;
    this.rejectPending(new Error("client transport generation changed"));

    void this.openSocket(generation).catch(error => {
      if (generation !== this.activeGeneration) return;
      const message = errorMessage(error);
      this.listener?.onError(generation, {
        code: "websocket-connect-failed",
        ...(message ? { message } : {}),
      });
    });
  }

  disconnect(generation: number): void {
    if (generation !== this.activeGeneration) return;
    const socket = this.socket;
    this.socket = null;
    this.rejectPending(new Error("client transport disconnected"));
    socket?.close({ code: 1000, reason: "client session disposed" });
  }

  async synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<TStatePayload>> {
    if (generation !== this.activeGeneration) {
      throw new Error("stale WeChat synchronization generation");
    }
    if (!sameCredentials(credentials, this.credentials)) {
      throw new Error("WeChat transport credentials do not match ClientSession");
    }

    const payload = await this.sendRequest(generation, "client:sync-state", {});
    const record = asRecord(payload);
    if (!record) throw new Error("raw WebSocket sync response is invalid");

    return parseStatePush<TStatePayload>({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: record,
    }, generation);
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    if (message.kind !== "command") {
      return Promise.reject(new Error(`WeChat client transport cannot send ${message.kind} messages`));
    }
    if (!this.socket) return Promise.reject(new Error("WeChat WebSocket is not open"));
    return this.sendRequest(this.activeGeneration, "client:command", message);
  }

  private async openSocket(generation: number): Promise<void> {
    const ticket = await this.issueTicket();
    if (generation !== this.activeGeneration) return;

    const url = `${socketBaseUrl(this.baseUrl)}/rooms/${encodeURIComponent(this.credentials.roomId)}` +
      `/websocket?ticket=${encodeURIComponent(ticket.ticket)}`;
    const socket = this.platform.connectSocket({ url });
    if (generation !== this.activeGeneration) {
      socket.close({ code: 1000, reason: "stale generation" });
      return;
    }
    this.socket = socket;

    socket.onOpen(() => {
      if (this.socket !== socket || generation !== this.activeGeneration) return;
      this.listener?.onOpen(generation);
    });
    socket.onClose(result => {
      if (this.socket !== socket || generation !== this.activeGeneration) return;
      this.socket = null;
      this.rejectPending(new Error(result?.reason || "WeChat WebSocket closed"));
      this.listener?.onClose(generation, result?.reason);
    });
    socket.onError(error => {
      if (this.socket !== socket || generation !== this.activeGeneration) return;
      const message = errorMessage(error);
      this.listener?.onError(generation, {
        code: "websocket-error",
        ...(message ? { message } : {}),
      });
    });
    socket.onMessage(result => {
      if (this.socket !== socket || generation !== this.activeGeneration) return;
      this.receiveMessage(generation, result.data);
    });
  }

  private issueTicket(): Promise<WebSocketTicketResponse> {
    const url = `${this.baseUrl}/rooms/${encodeURIComponent(this.credentials.roomId)}/websocket-ticket`;
    return new Promise((resolve, reject) => {
      this.platform.request({
        url,
        method: "POST",
        header: { "content-type": "application/json" },
        data: {
          playerId: this.credentials.playerId,
          resumeToken: this.credentials.resumeToken,
        },
        success: result => {
          const data = asRecord(result.data);
          if (
            result.statusCode < 200 ||
            result.statusCode >= 300 ||
            data?.ok !== true ||
            typeof data.ticket !== "string" ||
            !data.ticket
          ) {
            reject(new Error("unable to obtain WebSocket ticket"));
            return;
          }
          resolve({
            ok: true,
            ticket: data.ticket,
            expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : 0,
          });
        },
        fail: error => reject(new Error(errorMessage(error) || "WebSocket ticket request failed")),
      });
    });
  }

  private sendRequest(
    generation: number,
    type: "client:sync-state" | "client:command",
    payload: unknown,
  ): Promise<unknown> {
    if (generation !== this.activeGeneration) {
      return Promise.reject(new Error("stale WeChat request generation"));
    }
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("WeChat WebSocket is not open"));

    this.requestSequence += 1;
    const requestId = `wechat-${this.requestSequence}`;
    const frame = JSON.stringify({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId,
      type,
      payload,
    });

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(requestId, { generation, resolve, reject });
      socket.send({
        data: frame,
        fail: error => {
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.pending.delete(requestId);
          pending.reject(new Error(errorMessage(error) || "WeChat WebSocket send failed"));
        },
      });
    });
  }

  private receiveMessage(generation: number, data: unknown): void {
    if (typeof data !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const frame = asRecord(parsed);
    if (!frame || frame.protocolVersion !== CLIENT_PROTOCOL_VERSION) return;

    if (frame.kind === "response" && typeof frame.requestId === "string") {
      const pending = this.pending.get(frame.requestId);
      if (!pending || pending.generation !== generation) return;
      this.pending.delete(frame.requestId);
      const response = frame as ClientRawWebSocketResponse;
      if (response.ok) pending.resolve(response.payload);
      else pending.reject(new Error(response.error.message || response.error.code));
      return;
    }

    if (frame.kind !== "push" || typeof frame.type !== "string") return;
    if (frame.type === "client:state") {
      try {
        this.listener?.onState(parseStatePush<TStatePayload>(frame, generation));
      } catch (error) {
        const message = errorMessage(error);
        this.listener?.onError(generation, {
          code: "invalid-authoritative-state",
          ...(message ? { message } : {}),
        });
      }
      return;
    }

    if (frame.type === "client:event") {
      const envelope = asRecord(frame.payload);
      if (
        !envelope ||
        envelope.protocolVersion !== CLIENT_PROTOCOL_VERSION ||
        envelope.kind !== "event" ||
        typeof envelope.type !== "string" ||
        !envelope.type.trim()
      ) {
        return;
      }
      this.listener?.onEvent({
        generation,
        envelope: envelope as ClientRealtimeEventEnvelope,
      });
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
