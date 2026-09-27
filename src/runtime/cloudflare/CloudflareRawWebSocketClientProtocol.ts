import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import { GameRuleError } from "../../games/werewolf/WerewolfDomainFacade.js";
import type { ClientCommandEnvelope } from "../../protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketStateFrame,
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
  type ClientRawWebSocketRequest,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  isWerewolfLifecycleClientCommand,
} from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import {
  parseWerewolfClientCommandEnvelope,
} from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import {
  createCloudflarePlayerStateEnvelope,
  executeCloudflareClientProtocolCommand,
} from "./CloudflareClientProtocolAdapter.js";
import {
  CloudflareRoomRealtime,
  type HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfCommandRuntime } from "./CloudflareWerewolfCommandRuntime.js";

type ClientSnapshot = RoomSnapshot<GameState, GameConfig, unknown, unknown, unknown>;

function commandFailureMessage(error: unknown): string {
  return error instanceof GameRuleError ? error.message : "操作失败，请重试";
}

/**
 * E3.2b application bridge between the stable Raw WebSocket wire contract and
 * the existing Cloudflare authoritative client-protocol/runtime boundaries.
 *
 * Wire framing stays in protocol/client. This adapter authenticates only from
 * the already-bound Hibernation WebSocket identity supplied by the room shell.
 */
export class CloudflareRawWebSocketClientProtocol {
  private readonly snapshots: CloudflareRoomSnapshotRepository<ClientSnapshot>;
  private readonly commands: CloudflareWerewolfCommandRuntime;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly realtime: CloudflareRoomRealtime,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository<ClientSnapshot>(storage);
    this.commands = new CloudflareWerewolfCommandRuntime(storage);
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

    const result = {
      revision: snapshot.revision,
      envelope: createCloudflarePlayerStateEnvelope(snapshot, playerId),
    };
    webSocket.send(encodeClientRawWebSocketFrame(
      createClientRawWebSocketSuccessResponse(requestId, result),
    ));
  }

  private async handleCommand(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    if (isWerewolfLifecycleClientCommand(envelope)) {
      this.sendFailure(
        webSocket,
        requestId,
        "unsupported_command",
        "当前 Cloudflare runtime 尚未支持该生命周期命令",
      );
      return;
    }

    let parsed;
    try {
      parsed = parseWerewolfClientCommandEnvelope(envelope);
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
      const execution = await executeCloudflareClientProtocolCommand(
        this.commands,
        playerId,
        parsed,
      );
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(requestId, {
          revision: execution.revision,
          replayed: execution.replayed,
        }),
      ));
      this.pushPrivateStates(execution.snapshot);
    } catch (error) {
      this.sendFailure(
        webSocket,
        requestId,
        "command_failed",
        commandFailureMessage(error),
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

  private pushPrivateStates(snapshot: ClientSnapshot): void {
    for (const member of snapshot.membership) {
      try {
        const frame = createClientRawWebSocketStateFrame(
          snapshot.revision,
          createCloudflarePlayerStateEnvelope(snapshot, member.id),
        );
        this.realtime.sendToPlayer(member.id, encodeClientRawWebSocketFrame(frame));
      } catch {
        // State push is recoverable via explicit authoritative sync. A delivery
        // failure after a committed command must not turn a successful ACK into
        // a contradictory request failure.
      }
    }
  }
}
