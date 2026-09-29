import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import { SessionTokenService } from "../../core/session/SessionTokenService.js";
import {
  gameAdmission,
  isGameType,
  type GameType,
} from "../../games/GameCatalog.js";
import {
  IdentityRecoveryError,
} from "../shared/IdentityRecoveryService.js";
import {
  RoomBootstrapError,
  RoomBootstrapService,
} from "../shared/RoomBootstrapService.js";
import {
  ClientRawWebSocketWireError,
  createClientRawWebSocketProtocolErrorFrame,
  encodeClientRawWebSocketFrame,
  parseClientRawWebSocketRequest,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import {
  pushCloudflareAuthoritativeStates,
  type CloudflareClientSnapshot,
} from "./CloudflareAuthoritativeStateDelivery.js";
import { cloudflareSessionReplacedFrame } from "./CloudflareClientEventDelivery.js";
import {
  emitCloudflareActionAlertToPlayers,
  emitCloudflareInteractionTimeoutActive,
  emitCloudflareInteractionTimeoutError,
  emitCloudflareInteractionTimeoutInactive,
} from "./CloudflareInteractionTimeoutDelivery.js";
import { CloudflareInteractionTimeoutRuntime } from "./CloudflareInteractionTimeoutRuntime.js";
import { CloudflareIdentityRecoveryRuntime } from "./CloudflareIdentityRecoveryRuntime.js";
import {
  CloudflareRoomRealtime,
  type DurableObjectHibernationStateLike,
  type HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import { CloudflareRawWebSocketClientProtocol } from "./CloudflareRawWebSocketClientProtocol.js";
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

function gamePhase(snapshot: RoomSnapshot | undefined): string | undefined {
  const game = snapshot?.game;
  if (!game || typeof game !== "object" || Array.isArray(game)) return undefined;
  const phase = (game as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
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
  private readonly snapshots: CloudflareRoomSnapshotRepository<RoomSnapshot>;
  private readonly crypto = new CloudflareSessionTokenCryptoProvider();
  private readonly sessionTokens = new SessionTokenService(this.crypto);
  private readonly webSocketTickets: CloudflareWebSocketTicketRepository;
  private readonly interactionTimeouts: CloudflareInteractionTimeoutRuntime;
  private readonly identityRecovery: CloudflareIdentityRecoveryRuntime;

  constructor(private readonly state: DurableObjectStateLike) {
    this.snapshots = new CloudflareRoomSnapshotRepository<RoomSnapshot>(state.storage);
    this.webSocketTickets = new CloudflareWebSocketTicketRepository(state.storage, this.crypto);
    this.interactionTimeouts = new CloudflareInteractionTimeoutRuntime(state.storage);
    this.identityRecovery = new CloudflareIdentityRecoveryRuntime(
      state.storage,
      this.sessionTokens,
      {
        isPlayerConnected: playerId => {
          const realtimeState = hibernationState(this.state);
          return realtimeState
            ? new CloudflareRoomRealtime(realtimeState).isPlayerConnected(playerId)
            : false;
        },
      },
    );

    const realtimeState = hibernationState(state);
    const Pair = autoResponsePairConstructor();
    if (realtimeState?.setWebSocketAutoResponse && Pair) {
      realtimeState.setWebSocketAutoResponse(new Pair("ping", "pong"));
    }
  }

  private bootstrapFor(gameType: GameType): RoomBootstrapService<unknown, unknown> {
    const admission = gameAdmission(gameType);
    return new RoomBootstrapService<unknown, unknown>(this.sessionTokens, {
      gameType: admission.gameType,
      maxPlayers: admission.maxPlayers,
      createInitialGameConfig: admission.createInitialGameConfig,
      createPlayerId: () => this.crypto.randomToken(16),
    });
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
      const snapshot = await request.json() as CloudflareClientSnapshot;
      await this.snapshots.save(snapshot);
      return Response.json({ ok: true, revision: snapshot.revision });
    }

    if (url.pathname === "/snapshot" && request.method === "DELETE") {
      const deleted = await this.snapshots.clear();
      await this.interactionTimeouts.clearAll();
      await this.identityRecovery.clear();
      return Response.json({ ok: true, deleted });
    }

    if (url.pathname === "/bootstrap-create" && request.method === "POST") {
      return this.createRoomSession(request);
    }

    if (url.pathname === "/bootstrap-join" && request.method === "POST") {
      return this.joinRoomSession(request);
    }

    if (url.pathname === "/identity-recovery" && request.method === "POST") {
      return this.handleIdentityRecovery(request);
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
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketProtocolErrorFrame("binary_not_supported"),
      ));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketProtocolErrorFrame("invalid_json"),
      ));
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

    try {
      const request = parseClientRawWebSocketRequest(parsed);
      await new CloudflareRawWebSocketClientProtocol(
        this.state.storage,
        realtime,
      ).handleRequest(webSocket, playerId, request);
    } catch (error) {
      const wireError = error instanceof ClientRawWebSocketWireError ? error : undefined;
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketProtocolErrorFrame(
          wireError?.code ?? "server_error",
          {
            ...(wireError?.requestId ? { requestId: wireError.requestId } : {}),
            ...(wireError?.message ? { message: wireError.message } : {}),
          },
        ),
      ));
    }
  }

  async alarm(): Promise<void> {
    const execution = await this.interactionTimeouts.handleAlarm();
    const realtimeState = hibernationState(this.state);
    if (!realtimeState || execution.kind === "none") return;

    const realtime = new CloudflareRoomRealtime(realtimeState);
    switch (execution.kind) {
      case "warning": {
        const snapshot = await this.snapshots.load();
        const phase = gamePhase(snapshot);
        emitCloudflareActionAlertToPlayers(
          realtime,
          execution.state.actorPlayerIds,
          {
            actionId: execution.state.actionId,
            ...(phase === undefined ? {} : { phase }),
            timeoutWarning: true,
          },
        );
        emitCloudflareInteractionTimeoutActive(
          realtime,
          execution.state,
          true,
        );
        return;
      }

      case "recovered":
        emitCloudflareInteractionTimeoutInactive(
          realtime,
          execution.previous,
        );
        pushCloudflareAuthoritativeStates(
          realtime,
          execution.snapshot,
        );
        if (execution.next.created && execution.next.active) {
          emitCloudflareInteractionTimeoutActive(
            realtime,
            execution.next.active,
          );
          const phase = gamePhase(execution.snapshot);
          emitCloudflareActionAlertToPlayers(
            realtime,
            execution.next.active.actorPlayerIds,
            {
              actionId: execution.next.active.actionId,
              ...(phase === undefined ? {} : { phase }),
            },
          );
        }
        return;

      case "error":
        emitCloudflareInteractionTimeoutInactive(
          realtime,
          execution.previous,
        );
        emitCloudflareInteractionTimeoutError(
          realtime,
          execution.previous,
          execution.message,
        );
        return;

      case "reconciled":
        if (
          execution.transition.cleared &&
          execution.transition.previous
        ) {
          emitCloudflareInteractionTimeoutInactive(
            realtime,
            execution.transition.previous,
          );
        }
        if (
          execution.transition.created &&
          execution.transition.active
        ) {
          emitCloudflareInteractionTimeoutActive(
            realtime,
            execution.transition.active,
          );
        }
        return;
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

  private async createRoomSession(request: Request): Promise<Response> {
    let body: { roomId?: unknown; gameType?: unknown; name?: unknown };
    try {
      body = await request.json() as { roomId?: unknown; gameType?: unknown; name?: unknown };
    } catch {
      return Response.json(
        { ok: false, code: "invalid_request", message: "invalid request body" },
        { status: 400 },
      );
    }

    if (typeof body.roomId !== "string" || !/^\d{4}$/u.test(body.roomId)) {
      return Response.json(
        { ok: false, code: "invalid_room_code", message: "roomId must be exactly 4 digits" },
        { status: 400 },
      );
    }
    if (!isGameType(body.gameType)) {
      return Response.json(
        { ok: false, code: "invalid_game_type", message: "unsupported gameType" },
        { status: 400 },
      );
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      return Response.json(
        { ok: false, code: "invalid_name", message: "name must be a string" },
        { status: 400 },
      );
    }
    if (await this.snapshots.load()) {
      return Response.json(
        { ok: false, code: "room_already_exists", message: "房间号已被占用" },
        { status: 409 },
      );
    }

    const created = await this.bootstrapFor(body.gameType).create(body.roomId, body.name);
    // A reused Durable Object room code must never inherit timeout config,
    // identity-recovery grants, receipts, or alarms from a previous incarnation.
    await this.interactionTimeouts.clearAll();
    await this.identityRecovery.clear();
    await this.snapshots.save(created.snapshot);
    return Response.json({ ok: true, ...created.session }, { status: 201 });
  }

  private async joinRoomSession(request: Request): Promise<Response> {
    let body: { gameType?: unknown; name?: unknown };
    try {
      body = await request.json() as { gameType?: unknown; name?: unknown };
    } catch {
      return Response.json(
        { ok: false, code: "invalid_request", message: "invalid request body" },
        { status: 400 },
      );
    }
    if (!isGameType(body.gameType)) {
      return Response.json(
        { ok: false, code: "invalid_game_type", message: "unsupported gameType" },
        { status: 400 },
      );
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      return Response.json(
        { ok: false, code: "invalid_name", message: "name must be a string" },
        { status: 400 },
      );
    }

    const snapshot = await this.snapshots.load();
    if (!snapshot) {
      return Response.json(
        { ok: false, code: "room_not_found", message: "房间不存在" },
        { status: 404 },
      );
    }

    if (!isGameType(snapshot.metadata.gameType)) {
      return Response.json(
        { ok: false, code: "unsupported_room_game", message: "room gameType is unsupported" },
        { status: 409 },
      );
    }
    if (snapshot.metadata.gameType !== body.gameType) {
      return Response.json(
        { ok: false, code: "game_type_mismatch", message: "房间属于另一个游戏客户端" },
        { status: 409 },
      );
    }

    try {
      const joined = await this.bootstrapFor(snapshot.metadata.gameType).join(snapshot, body.name);
      const nextSnapshot = joined.snapshot;
      await this.snapshots.save(nextSnapshot);
      const realtimeState = hibernationState(this.state);
      if (realtimeState) {
        pushCloudflareAuthoritativeStates(
          new CloudflareRoomRealtime(realtimeState),
          nextSnapshot,
        );
      }
      return Response.json({ ok: true, ...joined.session });
    } catch (error) {
      if (error instanceof RoomBootstrapError) {
        return Response.json(
          { ok: false, code: error.code, message: error.message },
          { status: 409 },
        );
      }
      return Response.json(
        { ok: false, code: "join_failed", message: "加入房间失败" },
        { status: 500 },
      );
    }
  }

  private async handleIdentityRecovery(request: Request): Promise<Response> {
    let body: {
      operation?: unknown;
      playerId?: unknown;
      resumeToken?: unknown;
      targetPlayerId?: unknown;
      recoveryCode?: unknown;
    };
    try {
      body = await request.json() as typeof body;
    } catch {
      return Response.json(
        { ok: false, code: "invalid_request", message: "invalid request body" },
        { status: 400 },
      );
    }

    try {
      if (body.operation === "issue") {
        if (
          typeof body.playerId !== "string" ||
          typeof body.resumeToken !== "string" ||
          typeof body.targetPlayerId !== "string"
        ) {
          return Response.json(
            {
              ok: false,
              code: "invalid_request",
              message: "playerId, resumeToken and targetPlayerId are required",
            },
            { status: 400 },
          );
        }
        const grant = await this.identityRecovery.issue(
          body.playerId,
          body.resumeToken,
          body.targetPlayerId,
        );
        return Response.json({ ok: true, ...grant });
      }

      if (body.operation === "claim") {
        if (typeof body.recoveryCode !== "string") {
          return Response.json(
            { ok: false, code: "invalid_request", message: "recoveryCode is required" },
            { status: 400 },
          );
        }
        const claimed = await this.identityRecovery.claim(body.recoveryCode);
        const realtimeState = hibernationState(this.state);
        if (realtimeState) {
          const realtime = new CloudflareRoomRealtime(realtimeState);
          realtime.sendToPlayer(
            claimed.session.playerId,
            cloudflareSessionReplacedFrame(
              claimed.session.roomId,
              claimed.session.playerId,
            ),
          );
          realtime.closePlayerSockets(
            claimed.session.playerId,
            4001,
            "session replaced",
          );
          pushCloudflareAuthoritativeStates(
            realtime,
            claimed.snapshot as CloudflareClientSnapshot,
          );
        }
        return Response.json({ ok: true, ...claimed.session });
      }

      return Response.json(
        { ok: false, code: "invalid_request", message: "unsupported recovery operation" },
        { status: 400 },
      );
    } catch (error) {
      if (error instanceof IdentityRecoveryError) {
        const status = error.code === "not_recovery_controller"
          ? 403
          : error.code === "invalid_or_expired"
            ? 401
            : 409;
        return Response.json(
          { ok: false, code: error.code, message: error.message },
          { status },
        );
      }
      if (error instanceof Error && error.message === "invalid_session") {
        return Response.json(
          { ok: false, code: "invalid_session", message: "invalid session credentials" },
          { status: 401 },
        );
      }
      if (error instanceof Error && error.message === "room_not_found") {
        return Response.json(
          { ok: false, code: "room_not_found", message: "房间不存在" },
          { status: 404 },
        );
      }
      return Response.json(
        { ok: false, code: "identity_recovery_failed", message: "身份恢复失败，请重试" },
        { status: 500 },
      );
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
    if (!isGameType(snapshot.metadata.gameType)) {
      return Response.json(
        { ok: false, code: "unsupported_room_game", message: "房间游戏类型不受支持" },
        { status: 409 },
      );
    }

    const member = snapshot.membership.find(item => item.id === body.playerId);
    const valid = member && typeof member.resumeTokenHash === "string"
      ? await this.sessionTokens.verifySessionToken(body.resumeToken, member.resumeTokenHash)
      : false;

    if (!member || !valid) {
      return Response.json({ ok: false, message: "invalid session credentials" }, { status: 401 });
    }

    // A successful normal resume proves the existing credential is still in the
    // player's possession, so any host-assisted recovery grant is no longer valid.
    await this.identityRecovery.invalidate(member.id);
    const issued = await this.webSocketTickets.issue(
      body.playerId,
      member.resumeTokenHash,
    );
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

    // The player might have left the room or rotated credentials between ticket
    // issuance and upgrade. Binding the ticket to the credential hash prevents an
    // already-issued old-session ticket from surviving identity recovery.
    const snapshot = await this.snapshots.load();
    const member = snapshot?.membership.find(item => item.id === ticketRecord.playerId);
    const roomId = snapshot?.metadata.roomId;
    if (!member || !roomId || member.resumeTokenHash !== ticketRecord.resumeTokenHash) {
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
    new CloudflareRoomRealtime(realtimeState).acceptPlayerSocket(
      server,
      ticketRecord.playerId,
      cloudflareSessionReplacedFrame(
        roomId,
        ticketRecord.playerId,
      ),
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as WebSocketResponseInit);
  }
}
