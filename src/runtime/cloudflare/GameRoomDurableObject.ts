import { SessionTokenService } from "../../core/session/SessionTokenService.js";
import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import {
  CloudflareRoomRealtime,
  type DurableObjectHibernationStateLike,
  type HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import { CloudflareSessionTokenCryptoProvider } from "./CloudflareSessionTokenCryptoProvider.js";
import { CloudflareWebSocketTicketRepository } from "./CloudflareWebSocketTicketRepository.js";

type DurableObjectIdLike = {
  toString(): string;
};

type DurableObjectStateLike = {
  id: DurableObjectIdLike;
  storage: DurableObjectStorageLike;
} & Partial<DurableObjectHibernationStateLike>;

type WebSocketPairLike = {
  0: HibernationWebSocketLike;
  1: HibernationWebSocketLike;
};

type WebSocketPairConstructor = new () => WebSocketPairLike;
type WebSocketRequestResponsePairConstructor = new (
  request: string,
  response: string,
) => unknown;
type WebSocketResponseInit = ResponseInit & {
  webSocket: HibernationWebSocketLike;
};

function webSocketPairConstructor(): WebSocketPairConstructor | undefined {
  return (globalThis as unknown as { WebSocketPair?: WebSocketPairConstructor }).WebSocketPair;
}

function autoResponsePairConstructor(): WebSocketRequestResponsePairConstructor | undefined {
  return (globalThis as unknown as {
    WebSocketRequestResponsePair?: WebSocketRequestResponsePairConstructor;
  }).WebSocketRequestResponsePair;
}

function hibernationState(
  state: DurableObjectStateLike,
): DurableObjectHibernationStateLike | undefined {
  if (typeof state.acceptWebSocket !== "function" || typeof state.getWebSockets !== "function") {
    return undefined;
  }
  return state as DurableObjectHibernationStateLike;
}

function jsonMessage(type: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, ...payload });
}

/**
 * D4 Durable Object room shell with Hibernation WebSocket transport.
 *
 * Authoritative game recovery remains in RoomSnapshot/Durable Object storage.
 * Live connection identity is stored only in Hibernation WebSocket tags and
 * serialized attachments, so an object eviction does not disconnect players or
 * require an in-memory session registry to be rebuilt.
 */
export class GameRoomDurableObject {
  private readonly snapshots: CloudflareRoomSnapshotRepository;
  private readonly crypto = new CloudflareSessionTokenCryptoProvider();
  private readonly sessionTokens = new SessionTokenService(this.crypto);
  private readonly webSocketTickets: CloudflareWebSocketTicketRepository;

  constructor(private readonly state: DurableObjectStateLike) {
    this.snapshots = new CloudflareRoomSnapshotRepository(state.storage);
    this.webSocketTickets = new CloudflareWebSocketTicketRepository(state.storage, this.crypto);

    const realtimeState = hibernationState(state);
    const Pair = autoResponsePairConstructor();
    if (realtimeState?.setWebSocketAutoResponse && Pair) {
      realtimeState.setWebSocketAutoResponse(new Pair("ping", "pong"));
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/identity" && request.method === "GET") {
      return Response.json({
        ok: true,
        objectId: this.state.id.toString(),
      });
    }

    if (url.pathname === "/snapshot" && request.method === "GET") {
      const snapshot = await this.snapshots.load();
      if (!snapshot) return new Response("Not Found", { status: 404 });
      return Response.json(snapshot);
    }

    if (url.pathname === "/snapshot" && request.method === "PUT") {
      const snapshot = await request.json() as RoomSnapshot;
      await this.snapshots.save(snapshot);
      return Response.json({ ok: true, revision: snapshot.revision });
    }

    if (url.pathname === "/snapshot" && request.method === "DELETE") {
      const deleted = await this.snapshots.clear();
      return Response.json({ ok: true, deleted });
    }

    if (url.pathname === "/websocket-ticket" && request.method === "POST") {
      return this.issueWebSocketTicket(request);
    }

    if (url.pathname === "/websocket" && request.method === "GET") {
      return this.upgradeWebSocket(request, url);
    }

    return new Response("Not Found", { status: 404 });
  }

  async webSocketMessage(
    webSocket: HibernationWebSocketLike,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const realtimeState = hibernationState(this.state);
    if (!realtimeState) {
      webSocket.close(1011, "hibernation runtime unavailable");
      return;
    }

    const realtime = new CloudflareRoomRealtime(realtimeState);
    const playerId = realtime.playerIdForSocket(webSocket);
    if (!playerId) {
      webSocket.close(4003, "unbound session");
      return;
    }

    if (typeof message !== "string") {
      webSocket.send(jsonMessage("realtime:error", { code: "binary_not_supported" }));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      webSocket.send(jsonMessage("realtime:error", { code: "invalid_json" }));
      return;
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { type?: unknown }).type === "session:whoami"
    ) {
      webSocket.send(jsonMessage("session:bound", { playerId }));
      return;
    }

    webSocket.send(jsonMessage("realtime:error", { code: "unsupported_message" }));
  }

  webSocketClose(
    webSocket: HibernationWebSocketLike,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): void {
    webSocket.close(code, reason);
  }

  webSocketError(webSocket: HibernationWebSocketLike, _error: unknown): void {
    webSocket.close(1011, "websocket error");
  }

  private async issueWebSocketTicket(request: Request): Promise<Response> {
    let body: { playerId?: unknown; resumeToken?: unknown };
    try {
      body = await request.json() as { playerId?: unknown; resumeToken?: unknown };
    } catch {
      return Response.json({ ok: false, message: "invalid request body" }, { status: 400 });
    }

    if (typeof body.playerId !== "string" || typeof body.resumeToken !== "string") {
      return Response.json({ ok: false, message: "playerId and resumeToken are required" }, {
        status: 400,
      });
    }

    const snapshot = await this.snapshots.load();
    if (!snapshot) return new Response("Not Found", { status: 404 });

    const member = snapshot.membership.find(item => item.id === body.playerId);
    const valid = member && typeof member.resumeTokenHash === "string"
      ? await this.sessionTokens.verifySessionToken(body.resumeToken, member.resumeTokenHash)
      : false;

    if (!valid) {
      return Response.json({ ok: false, message: "invalid session credentials" }, { status: 401 });
    }

    const issued = await this.webSocketTickets.issue(body.playerId);
    return Response.json({
      ok: true,
      ticket: issued.ticket,
      expiresAt: issued.expiresAt,
    });
  }

  private async upgradeWebSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const ticket = url.searchParams.get("ticket");
    const ticketRecord = ticket ? await this.webSocketTickets.consume(ticket) : undefined;
    if (!ticketRecord) {
      return Response.json({ ok: false, message: "invalid WebSocket ticket" }, { status: 401 });
    }

    // The player might have left the room between ticket issuance and upgrade.
    const snapshot = await this.snapshots.load();
    if (!snapshot?.membership.some(member => member.id === ticketRecord.playerId)) {
      return Response.json({ ok: false, message: "invalid WebSocket ticket" }, { status: 401 });
    }

    const realtimeState = hibernationState(this.state);
    const Pair = webSocketPairConstructor();
    if (!realtimeState || !Pair) {
      return new Response("Hibernation WebSocket runtime unavailable", { status: 500 });
    }

    const pair = new Pair();
    const client = pair[0];
    const server = pair[1];
    new CloudflareRoomRealtime(realtimeState).acceptPlayerSocket(server, ticketRecord.playerId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as WebSocketResponseInit);
  }
}
