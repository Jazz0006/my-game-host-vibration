import type { SessionTokenCryptoProvider } from "../../core/security/SessionTokenCryptoProvider.js";
import type { DurableObjectStorageLike } from "./CloudflareRoomSnapshotRepository.js";

const TICKET_PREFIX = "room:websocket-ticket:v1:";
const DEFAULT_TTL_MS = 30_000;
const TICKET_BYTES = 24;

export type WebSocketTicketRecord = {
  playerId: string;
  expiresAt: number;
};

export type IssuedWebSocketTicket = WebSocketTicketRecord & {
  ticket: string;
};

/**
 * Short-lived, single-use ticket exchange for browser WebSocket upgrades.
 * Long-lived resume tokens never need to appear in a WebSocket URL.
 */
export class CloudflareWebSocketTicketRepository {
  constructor(
    private readonly storage: DurableObjectStorageLike,
    private readonly crypto: SessionTokenCryptoProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async issue(playerId: string, ttlMs = DEFAULT_TTL_MS): Promise<IssuedWebSocketTicket> {
    if (!playerId) throw new Error("playerId is required");
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("WebSocket ticket ttl must be a positive safe integer");
    }

    const ticket = this.crypto.randomToken(TICKET_BYTES);
    const record: WebSocketTicketRecord = {
      playerId,
      expiresAt: this.now() + ttlMs,
    };
    await this.storage.put(`${TICKET_PREFIX}${ticket}`, record);
    return { ticket, ...record };
  }

  async consume(ticket: string): Promise<WebSocketTicketRecord | undefined> {
    if (!ticket) return undefined;

    const key = `${TICKET_PREFIX}${ticket}`;
    const record = await this.storage.get<WebSocketTicketRecord>(key);
    if (!record) return undefined;

    // Delete before validation so a ticket is single-use even if it expires
    // between lookup and consumption.
    await this.storage.delete(key);
    if (record.expiresAt <= this.now()) return undefined;
    return record;
  }
}
