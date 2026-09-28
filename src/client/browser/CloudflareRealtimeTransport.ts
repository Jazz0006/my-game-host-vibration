import type {
  ClientProtocolMessage,
  ClientReconnectCredentials,
} from "../../protocol/client/ClientProtocol.js";
import {
  type ClientAuthoritativeStateDelivery,
  type ClientRealtimeTransport,
  type ClientRealtimeTransportListener,
} from "../runtime/ClientRealtimeTransport.js";
import {
  normalizeRawWebSocketBaseUrl,
  parseRawWebSocketTicketResponse,
  rawWebSocketRoomResourceUrl,
  rawWebSocketUrl,
} from "../runtime/RawWebSocketClientEndpoint.js";
import {
  RawWebSocketClientTransportCore,
  type RawWebSocketTextSender,
} from "../runtime/RawWebSocketClientTransportCore.js";

export type BrowserFetchResponseLike = {
  status: number;
  json(): Promise<unknown>;
};

export type BrowserFetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: { "content-type": "application/json" };
    body: string;
  },
) => Promise<BrowserFetchResponseLike>;

export type BrowserWebSocketLike = {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { reason?: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: string | ArrayBuffer }) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type BrowserWebSocketFactory = (url: string) => BrowserWebSocketLike;

export type CloudflareRealtimeTransportOptions = {
  baseUrl: string;
  fetch?: BrowserFetchLike;
  webSocketFactory?: BrowserWebSocketFactory;
  requestIdFactory?: () => string;
  requestTimeoutMs?: number;
  commandRetries?: number;
};

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : undefined;
}

const defaultBrowserFetch: BrowserFetchLike = (url, init) =>
  globalThis.fetch(url, init);

const defaultBrowserWebSocketFactory: BrowserWebSocketFactory = url =>
  new globalThis.WebSocket(url) as unknown as BrowserWebSocketLike;

/**
 * Browser Raw WebSocket transport targeting the Cloudflare authoritative room
 * runtime. Browser capabilities stay here; stable framing/request semantics are
 * shared with the native WeChat transport through RawWebSocketClientTransportCore.
 */
export class CloudflareRealtimeTransport<TStatePayload = unknown>
implements ClientRealtimeTransport<TStatePayload> {
  private readonly baseUrl: string;
  private readonly fetchImpl: BrowserFetchLike;
  private readonly webSocketFactory: BrowserWebSocketFactory;
  private readonly core: RawWebSocketClientTransportCore<TStatePayload>;
  private socket: BrowserWebSocketLike | null = null;

  constructor(options: CloudflareRealtimeTransportOptions) {
    this.baseUrl = normalizeRawWebSocketBaseUrl(options.baseUrl, "Browser");
    this.fetchImpl = options.fetch ?? defaultBrowserFetch;
    this.webSocketFactory = options.webSocketFactory ?? defaultBrowserWebSocketFactory;
    this.core = new RawWebSocketClientTransportCore<TStatePayload>({
      transportLabel: "Browser",
      requestIdPrefix: "browser",
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
      previousSocket?.close(1000, "connection generation replaced");
    }

    void this.connectCurrent(credentials, generation);
  }

  disconnect(generation: number): void {
    if (!this.core.isActiveGeneration(generation)) return;
    const socket = this.socket;
    this.socket = null;
    this.core.disconnect(generation);
    socket?.close(1000, "client disconnect");
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

  private async connectCurrent(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<void> {
    let response: BrowserFetchResponseLike;
    try {
      response = await this.fetchImpl(
        rawWebSocketRoomResourceUrl(
          this.baseUrl,
          credentials.roomId,
          "websocket-ticket",
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playerId: credentials.playerId,
            resumeToken: credentials.resumeToken,
          }),
        },
      );
    } catch (error) {
      if (!this.core.isActiveGeneration(generation)) return;
      this.core.handleSocketClose(
        generation,
        errorMessage(error) || "Browser WebSocket ticket request failed",
      );
      return;
    }

    if (!this.core.isActiveGeneration(generation)) return;

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Let the shared ticket parser produce the stable HTTP-status failure.
    }

    if (!this.core.isActiveGeneration(generation)) return;

    let ticket;
    try {
      ticket = parseRawWebSocketTicketResponse(response.status, data);
    } catch (error) {
      this.core.reportError(generation, {
        code: "websocket-ticket-failed",
        ...(errorMessage(error) ? { message: errorMessage(error)! } : {}),
      });
      return;
    }

    let socket: BrowserWebSocketLike;
    try {
      socket = this.webSocketFactory(
        rawWebSocketUrl(this.baseUrl, credentials.roomId, ticket.ticket),
      );
    } catch (error) {
      this.core.handleSocketClose(
        generation,
        errorMessage(error) || "Browser WebSocket connect failed",
      );
      return;
    }

    if (!this.core.isActiveGeneration(generation)) {
      socket.close(1000, "stale connection generation");
      return;
    }

    this.socket = socket;
    this.bindSocket(socket, generation);
  }

  private bindSocket(socket: BrowserWebSocketLike, generation: number): void {
    socket.addEventListener("open", () => {
      if (!this.isActive(socket, generation)) return;
      this.core.open(generation, this.senderFor(socket));
    });

    socket.addEventListener("close", event => {
      if (!this.isActive(socket, generation)) return;
      this.socket = null;
      this.core.handleSocketClose(generation, event.reason);
    });

    socket.addEventListener("error", () => {
      if (!this.isActive(socket, generation)) return;
      const reason = "Browser WebSocket error";
      this.socket = null;
      this.core.handleSocketError(generation, reason);
      socket.close(1000, reason);
    });

    socket.addEventListener("message", event => {
      if (!this.isActive(socket, generation)) return;
      this.core.handleMessage(event.data, generation);
    });
  }

  private senderFor(socket: BrowserWebSocketLike): RawWebSocketTextSender {
    return async data => {
      socket.send(data);
    };
  }

  private isActive(socket: BrowserWebSocketLike, generation: number): boolean {
    return this.core.isActiveGeneration(generation) && socket === this.socket;
  }
}
