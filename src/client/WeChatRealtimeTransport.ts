import type {
  ClientProtocolMessage,
  ClientReconnectCredentials,
} from "../protocol/client/ClientProtocol.js";
import {
  type ClientAuthoritativeStateDelivery,
  type ClientRealtimeTransport,
  type ClientRealtimeTransportListener,
} from "./runtime/ClientRealtimeTransport.js";
import {
  normalizeRawWebSocketBaseUrl,
  parseRawWebSocketTicketResponse,
  rawWebSocketRoomResourceUrl,
  rawWebSocketUrl,
} from "./runtime/RawWebSocketClientEndpoint.js";
import {
  RawWebSocketClientTransportCore,
  type RawWebSocketTextSender,
} from "./runtime/RawWebSocketClientTransportCore.js";

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
  commandRetries?: number;
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

/**
 * Native WeChat ClientRealtimeTransport adapter.
 *
 * Ticket exchange and SocketTask binding remain platform-owned here. Stable Raw
 * WebSocket framing, request correlation/retry, generation fencing and
 * authoritative/event dispatch are delegated to the shared runtime core.
 */
export class WeChatRealtimeTransport<TStatePayload = unknown>
implements ClientRealtimeTransport<TStatePayload> {
  private readonly baseUrl: string;
  private readonly core: RawWebSocketClientTransportCore<TStatePayload>;
  private socket: WeChatSocketTaskLike | null = null;

  constructor(
    private readonly platform: WeChatPlatformLike,
    options: WeChatRealtimeTransportOptions,
  ) {
    this.baseUrl = normalizeRawWebSocketBaseUrl(options.baseUrl, "WeChat");
    this.core = new RawWebSocketClientTransportCore<TStatePayload>({
      transportLabel: "WeChat",
      requestIdPrefix: "wechat",
      ...(options.requestIdFactory
        ? { requestIdFactory: options.requestIdFactory }
        : {}),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.commandRetries === undefined
        ? {}
        : { commandRetries: options.commandRetries }),
    });
  }

  setListener(listener: ClientRealtimeTransportListener<TStatePayload>): void {
    this.core.setListener(listener);
  }

  connect(credentials: ClientReconnectCredentials, generation: number): void {
    const previousGeneration = this.core.getActiveGeneration();
    const previousSocket = this.socket;

    this.core.beginGeneration(generation);
    this.socket = null;

    if (previousGeneration > 0 && previousGeneration !== generation) {
      previousSocket?.close({ code: 1000, reason: "connection generation replaced" });
    }

    this.platform.request({
      url: rawWebSocketRoomResourceUrl(
        this.baseUrl,
        credentials.roomId,
        "websocket-ticket",
      ),
      method: "POST",
      data: {
        playerId: credentials.playerId,
        resumeToken: credentials.resumeToken,
      },
      success: response => {
        if (!this.core.isActiveGeneration(generation)) return;

        let ticket;
        try {
          ticket = parseRawWebSocketTicketResponse(
            response.statusCode,
            response.data,
          );
        } catch (error) {
          this.core.reportError(generation, {
            code: "websocket-ticket-failed",
            ...(errorMessage(error) ? { message: errorMessage(error)! } : {}),
          });
          return;
        }

        let socket: WeChatSocketTaskLike;
        try {
          socket = this.platform.connectSocket({
            url: rawWebSocketUrl(
              this.baseUrl,
              credentials.roomId,
              ticket.ticket,
            ),
          });
        } catch (error) {
          this.core.handleSocketClose(
            generation,
            errorMessage(error) || "WeChat WebSocket connect failed",
          );
          return;
        }

        if (!this.core.isActiveGeneration(generation)) {
          socket.close({ reason: "stale connection generation" });
          return;
        }

        this.socket = socket;
        this.bindSocket(socket, generation);
      },
      fail: error => {
        if (!this.core.isActiveGeneration(generation)) return;
        this.core.handleSocketClose(
          generation,
          errorMessage(error) || "WeChat WebSocket ticket request failed",
        );
      },
    });
  }

  disconnect(generation: number): void {
    if (!this.core.isActiveGeneration(generation)) return;
    const socket = this.socket;
    this.socket = null;
    this.core.disconnect(generation);
    socket?.close({ code: 1000, reason: "client disconnect" });
  }

  synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<TStatePayload>> {
    return this.core.synchronize(credentials, generation);
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    return this.core.send(message);
  }

  private bindSocket(socket: WeChatSocketTaskLike, generation: number): void {
    socket.onOpen(() => {
      if (!this.isActive(socket, generation)) return;
      this.core.open(generation, this.senderFor(socket));
    });

    socket.onClose(event => {
      if (!this.isActive(socket, generation)) return;
      this.socket = null;
      this.core.handleSocketClose(generation, event.reason);
    });

    socket.onError(error => {
      if (!this.isActive(socket, generation)) return;
      const reason = errorMessage(error) || "WeChat WebSocket error";
      this.socket = null;
      this.core.handleSocketError(generation, reason);
      socket.close({ reason });
    });

    socket.onMessage(event => {
      if (!this.isActive(socket, generation)) return;
      this.core.handleMessage(event.data, generation);
    });
  }

  private senderFor(socket: WeChatSocketTaskLike): RawWebSocketTextSender {
    return data => new Promise((resolve, reject) => {
      socket.send({
        data,
        success: resolve,
        fail: error => {
          reject(new Error(errorMessage(error) || "WeChat WebSocket send failed"));
        },
      });
    });
  }

  private isActive(socket: WeChatSocketTaskLike, generation: number): boolean {
    return this.core.isActiveGeneration(generation) && socket === this.socket;
  }
}
