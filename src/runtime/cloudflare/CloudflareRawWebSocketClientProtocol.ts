import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import { isGameType } from "../../games/GameCatalog.js";
import type { ClientCommandEnvelope } from "../../protocol/client/ClientProtocol.js";
import {
  isRoomManagementClientCommand,
  parseRoomManagementClientCommandEnvelope,
} from "../../protocol/client/ClientRoomManagementProtocol.js";
import {
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
  type ClientRawWebSocketRequest,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  createCloudflarePlayerStateEnvelope,
  createCloudflareRoomStateEnvelope,
} from "./CloudflareClientProtocolAdapter.js";
import { pushCloudflareAuthoritativeStates } from "./CloudflareAuthoritativeStateDelivery.js";
import {
  emitCloudflareRoomClosed,
  emitCloudflareRoomRemoved,
} from "./CloudflareClientEventDelivery.js";
import {
  createCloudflareGameCommandHandler,
  type CloudflareGameCommandHandler,
} from "./CloudflareGameCommandRuntimeRegistry.js";
import { CloudflareRoomManagementRuntime } from "./CloudflareRoomManagementRuntime.js";
import {
  CloudflareRoomRealtime,
  type HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

type ClientSnapshot = RoomSnapshot;

/**
 * Shared Raw WebSocket application bridge.
 *
 * This layer owns only transport framing, membership/sync, room-management
 * commands, and gameType dispatch. Concrete game command/lifecycle/recovery/
 * timeout behavior lives behind CloudflareGameCommandHandler.
 */
export class CloudflareRawWebSocketClientProtocol {
  private readonly snapshots: CloudflareRoomSnapshotRepository<ClientSnapshot>;
  private readonly roomManagement: CloudflareRoomManagementRuntime;

  constructor(
    private readonly storage: DurableObjectStorageLike,
    private readonly realtime: CloudflareRoomRealtime,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository<ClientSnapshot>(storage);
    this.roomManagement = new CloudflareRoomManagementRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
  }

  async handleRequest(
    webSocket: HibernationWebSocketLike,
    authenticatedPlayerId: string,
    request: ClientRawWebSocketRequest,
  ): Promise<void> {
    switch (request.operation) {
      case "sync":
        await this.handleSync(webSocket, authenticatedPlayerId, request.requestId);
        return;
      case "command":
        await this.handleCommand(
          webSocket,
          authenticatedPlayerId,
          request.requestId,
          request.envelope,
        );
        return;
    }
  }

  private async handleSync(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
  ): Promise<void> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) {
      this.sendFailure(webSocket, requestId, "room_not_found", "房间不存在");
      return;
    }
    if (!snapshot.membership.some(member => member.id === playerId)) {
      this.sendFailure(webSocket, requestId, "not_room_member", "你当前不在房间中");
      return;
    }
    if (!isGameType(snapshot.metadata.gameType)) {
      this.sendFailure(
        webSocket,
        requestId,
        "unsupported_room_game",
        "房间游戏类型不受支持",
      );
      return;
    }

    const result = {
      revision: snapshot.revision,
      envelope: createCloudflarePlayerStateEnvelope(snapshot, playerId),
      roomEnvelope: createCloudflareRoomStateEnvelope(
        snapshot,
        playerId,
        candidatePlayerId => this.realtime.isPlayerConnected(candidatePlayerId),
      ),
    };
    webSocket.send(encodeClientRawWebSocketFrame(
      createClientRawWebSocketSuccessResponse(requestId, result),
    ));

    const gameHandler = createCloudflareGameCommandHandler(
      snapshot.metadata.gameType,
      this.storage,
      this.realtime,
    );
    await gameHandler?.handleSync(playerId, snapshot);
  }

  private async handleCommand(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) {
      this.sendFailure(webSocket, requestId, "room_not_found", "房间不存在");
      return;
    }
    if (!isGameType(snapshot.metadata.gameType)) {
      this.sendFailure(
        webSocket,
        requestId,
        "unsupported_room_game",
        "房间游戏类型不受支持",
      );
      return;
    }

    const gameHandler = createCloudflareGameCommandHandler(
      snapshot.metadata.gameType,
      this.storage,
      this.realtime,
    );

    if (isRoomManagementClientCommand(envelope)) {
      await this.handleRoomManagement(
        webSocket,
        playerId,
        requestId,
        envelope,
        gameHandler,
      );
      return;
    }

    if (!gameHandler) {
      this.sendFailure(
        webSocket,
        requestId,
        "game_command_unavailable",
        "该游戏命令尚未启用",
      );
      return;
    }

    await gameHandler.handleCommand(webSocket, playerId, requestId, envelope);
  }

  private async handleRoomManagement(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
    gameHandler: CloudflareGameCommandHandler | undefined,
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseRoomManagementClientCommandEnvelope(envelope);
    } catch (error) {
      this.sendFailure(
        webSocket,
        requestId,
        "invalid_command",
        error instanceof Error ? error.message : "命令格式无效",
      );
      return;
    }

    try {
      const execution = await this.roomManagement.execute(playerId, parsed);
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(requestId, {
          revision: execution.revision,
          replayed: execution.replayed,
          outcome: execution.outcome,
        }),
      ));

      if (execution.replayed) return;
      if (execution.roomCleared) {
        await gameHandler?.clearRoomRuntimeState();
      }

      switch (execution.outcome.kind) {
        case "removedPlayer":
          emitCloudflareRoomRemoved(
            this.realtime,
            execution.snapshot?.metadata.roomId ?? "",
            execution.outcome.playerId,
          );
          this.realtime.closePlayerSockets(
            execution.outcome.playerId,
            4004,
            "removed from room",
          );
          break;

        case "leftAndTransferred":
          this.realtime.closePlayerSockets(
            execution.outcome.leavingPlayerId,
            1000,
            "left room",
          );
          break;

        case "leftRoom":
          this.realtime.closePlayerSockets(
            execution.outcome.leavingPlayerId,
            1000,
            "left room",
          );
          break;

        case "closedRoom":
          emitCloudflareRoomClosed(
            this.realtime,
            execution.outcome.roomId,
          );
          this.realtime.closeAllSockets(4005, "room closed");
          return;

        default:
          break;
      }

      if (execution.snapshot) {
        pushCloudflareAuthoritativeStates(
          this.realtime,
          execution.snapshot,
        );
      }
    } catch (error) {
      this.sendFailure(
        webSocket,
        requestId,
        "command_failed",
        error instanceof Error && error.message
          ? error.message
          : "操作失败，请重试",
      );
    }
  }

  private sendFailure(
    webSocket: HibernationWebSocketLike,
    requestId: string,
    code: string,
    message: string,
  ): void {
    webSocket.send(encodeClientRawWebSocketFrame(
      createClientRawWebSocketFailureResponse(requestId, code, message),
    ));
  }
}
