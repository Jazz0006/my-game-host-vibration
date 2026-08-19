import {
  CLIENT_PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
  type ClientStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import type {
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
  ClientRealtimeTransportListener,
} from "../runtime/ClientRealtimeTransport.js";

export type BrowserSocketIoLike = {
  connected: boolean;
  connect(): unknown;
  disconnect(): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  timeout(ms: number): {
    emit(
      event: string,
      payload: unknown,
      callback: (error: Error | null, result?: unknown) => void,
    ): unknown;
  };
};

type SyncAck =
  | {
      ok: true;
      revision: number;
      envelope: ClientStateEnvelope<unknown>;
    }
  | { ok: false; message?: string };

type BasicAck = { ok: true; [key: string]: unknown } | { ok: false; message?: string };

export type SocketIoRealtimeTransportOptions = {
  timeoutMs?: number;
  commandRetries?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStateDelivery<TStatePayload>(
  value: unknown,
  generation: number,
): ClientAuthoritativeStateDelivery<TStatePayload> {
  const record = asRecord(value);
  const revision = record?.revision;
  const envelope = asRecord(record?.envelope);

  if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
    throw new Error("authoritative client state revision is invalid");
  }
  if (
    !envelope ||
    envelope.protocolVersion !== CLIENT_PROTOCOL_VERSION ||
    envelope.kind !== "state" ||
    envelope.scope !== "player" ||
    typeof envelope.roomId !== "string" ||
    typeof envelope.playerId !== "string"
  ) {
    throw new Error("authoritative client state envelope is invalid");
  }

  return {
    generation,
    revision: Number(revision),
    envelope: envelope as ClientStateEnvelope<TStatePayload>,
  };
}

/**
 * Browser Socket.IO implementation of the E2.2 ClientRealtimeTransport port.
 * Socket.IO remains responsible for low-level reconnect attempts; ClientSession
 * owns connection generation, synchronization, revision reconciliation, and
 * the meaning of Connected.
 */
export class SocketIoRealtimeTransport<TStatePayload = unknown>
implements ClientRealtimeTransport<TStatePayload> {
  private listener: ClientRealtimeTransportListener<TStatePayload> | null = null;
  private activeGeneration = 0;
  private readonly timeoutMs: number;
  private readonly commandRetries: number;

  constructor(
    private readonly socket: BrowserSocketIoLike,
    options: SocketIoRealtimeTransportOptions = {},
  ) {
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 5000;
    this.commandRetries = Number.isInteger(options.commandRetries)
      ? Math.max(0, Number(options.commandRetries))
      : 1;

    socket.on("connect", () => {
      if (this.activeGeneration > 0) this.listener?.onOpen(this.activeGeneration);
    });
    socket.on("disconnect", (reason: unknown) => {
      if (this.activeGeneration <= 0) return;
      this.listener?.onClose(
        this.activeGeneration,
        typeof reason === "string" ? reason : undefined,
      );
    });
    socket.on("client:state", (value: unknown) => {
      if (this.activeGeneration <= 0) return;
      try {
        this.listener?.onState(
          parseStateDelivery<TStatePayload>(value, this.activeGeneration),
        );
      } catch (error) {
        this.listener?.onError(this.activeGeneration, {
          code: "invalid-authoritative-state",
          ...(error instanceof Error && error.message ? { message: error.message } : {}),
        });
      }
    });
  }

  setListener(listener: ClientRealtimeTransportListener<TStatePayload>): void {
    this.listener = listener;
  }

  connect(generation: number): void {
    this.activeGeneration = generation;
    if (this.socket.connected) {
      queueMicrotask(() => {
        if (this.activeGeneration === generation) this.listener?.onOpen(generation);
      });
      return;
    }
    this.socket.connect();
  }

  disconnect(generation: number): void {
    if (generation !== this.activeGeneration) return;
    this.socket.disconnect();
  }

  async synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<TStatePayload>> {
    if (generation !== this.activeGeneration) {
      throw new Error("stale Socket.IO synchronization generation");
    }

    const current = await this.emitAckWithRetry<SyncAck>("client:sync-state", {}, 1);
    if (current?.ok) return parseStateDelivery<TStatePayload>(current, generation);

    const resumed = await this.emitAck<BasicAck>("player:resume", credentials);
    if (!resumed?.ok) {
      throw new Error(resumed?.message || current?.message || "无法恢复上次房间");
    }

    const synchronized = await this.emitAckWithRetry<SyncAck>("client:sync-state", {}, 1);
    if (!synchronized?.ok) {
      throw new Error(synchronized?.message || "无法同步当前游戏状态");
    }
    return parseStateDelivery<TStatePayload>(synchronized, generation);
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    if (message.kind !== "command") {
      return Promise.reject(new Error(`Socket.IO client transport cannot send ${message.kind} messages`));
    }
    return this.emitAckWithRetry("client:command", message, this.commandRetries);
  }

  private emitAck<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.timeout(this.timeoutMs).emit(event, payload, (error, result) => {
        if (error) reject(error);
        else resolve(result as T);
      });
    });
  }

  private async emitAckWithRetry<T>(
    event: string,
    payload: unknown,
    maxRetries: number,
  ): Promise<T> {
    let attempts = 0;
    while (true) {
      try {
        return await this.emitAck<T>(event, payload);
      } catch (error) {
        if (attempts >= maxRetries) throw error;
        attempts += 1;
      }
    }
  }
}
