import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import type { ClientCommandEnvelope } from "../../protocol/client/ClientProtocol.js";
import {
  parseBotcClientCommandEnvelope,
} from "../../protocol/client/BotcClientProtocol.js";
import {
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import { pushCloudflareAuthoritativeStates } from "./CloudflareAuthoritativeStateDelivery.js";
import {
  CloudflareBotcCommandRuntime,
} from "./CloudflareBotcCommandRuntime.js";
import type {
  CloudflareGameCommandHandler,
} from "./CloudflareGameCommandRuntimeRegistry.js";
import type {
  CloudflareRoomRealtime,
  HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import type {
  DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

export class CloudflareBotcGameCommandHandler
implements CloudflareGameCommandHandler {
  private readonly commands: CloudflareBotcCommandRuntime;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly realtime: CloudflareRoomRealtime,
  ) {
    this.commands = new CloudflareBotcCommandRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
  }

  handleSync(_playerId: string, _snapshot: RoomSnapshot): Promise<void> {
    return Promise.resolve();
  }

  clearRoomRuntimeState(): Promise<void> {
    return Promise.resolve();
  }

  async handleCommand(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseBotcClientCommandEnvelope(envelope);
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
      const execution = await this.commands.execute(playerId, parsed);
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(requestId, {
          revision: execution.revision,
          replayed: execution.replayed,
          outcome: execution.outcome,
        }),
      ));
      if (!execution.replayed) {
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
