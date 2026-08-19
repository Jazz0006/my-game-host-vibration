export type HibernationWebSocketLike = {
  readyState?: number;
  send(message: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

export type DurableObjectHibernationStateLike = {
  acceptWebSocket(webSocket: HibernationWebSocketLike, tags?: string[]): void;
  getWebSockets(tag?: string): HibernationWebSocketLike[];
  setWebSocketAutoResponse?(pair: unknown): void;
};

export type RoomWebSocketAttachment = {
  version: 1;
  playerId: string;
};

const OPEN_READY_STATE = 1;
const SESSION_REPLACED_CLOSE_CODE = 4001;

export function playerWebSocketTag(playerId: string): string {
  return `user:${playerId}`;
}

function isOpen(webSocket: HibernationWebSocketLike): boolean {
  return webSocket.readyState === undefined || webSocket.readyState === OPEN_READY_STATE;
}

function parseAttachment(value: unknown): RoomWebSocketAttachment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<RoomWebSocketAttachment>;
  if (candidate.version !== 1 || typeof candidate.playerId !== "string" || !candidate.playerId) {
    return undefined;
  }
  return { version: 1, playerId: candidate.playerId };
}

/**
 * D4 realtime adapter around Cloudflare's Hibernation WebSocket state.
 * Connection identity lives in WebSocket tags + serialized attachments so it
 * survives Durable Object eviction without becoming part of RoomSnapshot.
 */
export class CloudflareRoomRealtime {
  constructor(private readonly state: DurableObjectHibernationStateLike) {}

  acceptPlayerSocket(webSocket: HibernationWebSocketLike, playerId: string): void {
    const tag = playerWebSocketTag(playerId);

    // C1 contract: a newly authenticated connection replaces any previous
    // connection for the same stable player identity.
    for (const existing of this.state.getWebSockets(tag)) {
      if (existing === webSocket || !isOpen(existing)) continue;
      existing.send(JSON.stringify({ type: "session:replaced" }));
      existing.close(SESSION_REPLACED_CLOSE_CODE, "session replaced");
    }

    this.state.acceptWebSocket(webSocket, [tag]);
    webSocket.serializeAttachment({ version: 1, playerId } satisfies RoomWebSocketAttachment);
  }

  playerIdForSocket(webSocket: HibernationWebSocketLike): string | undefined {
    return parseAttachment(webSocket.deserializeAttachment())?.playerId;
  }

  sendToPlayer(playerId: string, message: string | ArrayBuffer): number {
    let delivered = 0;
    for (const webSocket of this.state.getWebSockets(playerWebSocketTag(playerId))) {
      if (!isOpen(webSocket)) continue;
      webSocket.send(message);
      delivered += 1;
    }
    return delivered;
  }

  broadcast(message: string | ArrayBuffer): number {
    let delivered = 0;
    for (const webSocket of this.state.getWebSockets()) {
      if (!isOpen(webSocket)) continue;
      webSocket.send(message);
      delivered += 1;
    }
    return delivered;
  }
}
