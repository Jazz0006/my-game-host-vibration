import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import { SessionTokenService } from "../../core/session/SessionTokenService.js";
import {
  createClientRawWebSocketErrorResponse,
  createClientRawWebSocketStatePush,
  createClientRawWebSocketSuccessResponse,
  parseClientRawWebSocketRequest,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  createCloudflarePlayerStateEnvelope,
  executeCloudflareClientProtocolCommand,
} from "./CloudflareClientProtocolAdapter.js";
import {
  CloudflareRoomRealtime,
  type DurableObjectHibernationStateLike,
  type HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareSessionTokenCryptoProvider } from "./CloudflareSessionTokenCryptoProvider.js";
import { CloudflareWebSocketTicketRepository } from "./CloudflareWebSocketTicketRepository.js";
import { CloudflareWerewolfCommandRuntime } from "./CloudflareWerewolfCommandRuntime.js";

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

function rawRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId.trim() : undefined;
}

/**
 * Cloudflare Durable Object room shell.
 *
 * D4 owns authenticated Hibernation WebSocket identity. E3.2 adds a stable
 * request/response/push framing layer for transport-neutral ClientSession
 * adapters. Long-lived resume credentials still exchange for a short-lived
 * WebSocket ticket before upgrade; once bound, the serialized socket identity
 * is the authority for every client request.
 */
export class GameRoomDurableObject {
  private readonly snapshots: CloudflareRoomSnapshotRepository;
  private readonly crypto = new CloudflareSessionTokenCryptoProvider();
  private readonly sessionTokens = new SessionTokenService(this.crypto);
  private readonly webSocketTickets: CloudflareWebSocketTicketRepository;
  private readonly werewolfCommands: CloudflareWerewolfCommandRuntime;

  constructor(private readonly state: DurableObjectStateLike) {
    this.snapshots = new CloudflareRoomSnapshotRepository(state.storage);
    this.webSocketTickets = new CloudflareWebSocketTicketRepository(state.storage, this.crypto);
    this.werewolfCommands = new CloudflareWerewolfCommandRuntime(state.storage);

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

    // D4 diagnostic compatibility. Stable E3 clients use the versioned frames below.
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { type?: unknown }).type === "session:whoami"
    ) {
      webSocket.send(jsonMessage("session:bound", { playerId }));
      return;
    }

    let request;
    try {
      request = parseClientRawWebSocketRequest(parsed);
    } catch (error) {
      const requestId = rawRequestId(parsed);
      if (requestId) {
        webSocket.send(JSON.stringify(createClientRawWebSocketErrorResponse(
          requestId,
          "invalid_request",
          error instanceof Error ? error.message : undefined,
        )));
      } else {
        webSocket.send(jsonMessage("realtime:error", { code: "unsupported_message" }));
      }
      return;
    }

    try {
      if (request.type === "client:sync-state") {
        const snapshot = await this.snapshots.load();
        if (!snapshot) throw new Error("room snapshot not found");
        const envelope = createCloudflarePlayerStateEnvelope(snapshot as never, playerId);
        webSocket.send(JSON.stringify(createClientRawWebSocketSuccessResponse(request.requestId, {
          revision: snapshot.revision,
          envelope,
        })));
        return;
      }

      const execution = await executeCloudflareClientProtocolCommand(
        this.werewolfCommands,
        playerId,
        request.payload,
      );
      webSocket.send(JSON.stringify(createClientRawWebSocketSuccessResponse(request.requestId, {
        outcome: execution.outcome,
        replayed: execution.replayed,
        revision: execution.revision,
      })));
      this.pushAuthoritativeState(realtime, execution.snapshot);
    } catch (error) {
      webSocket.send(JSON.stringify(createClientRawWebSocketErrorResponse(
        request.requestId,
        request.type === "client:sync-state" ? "sync_failed" : "command_failed",
        error instanceof Error ? error.message : undefined,
      )));
    }
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

  private pushAuthoritativeState(realtime: CloudflareRoomRealtime, snapshot: RoomSnapshot): void {
    for (const member of snapshot.membership) {
      try {
        const envelope = createCloudflarePlayerStateEnvelope(snapshot as never, member.id);
        realtime.sendToPlayer(member.id, JSON.stringify(
          createClientRawWebSocketStatePush(snapshot.revision, envelope),
        ));
      } catch {
        // A stale connection must not make an already-committed authoritative
        // command fail. The next explicit synchronization remains the source of truth.
      }
    }
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
