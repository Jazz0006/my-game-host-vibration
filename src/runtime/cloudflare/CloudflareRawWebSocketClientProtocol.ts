import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import { GameRuleError } from "../../games/werewolf/WerewolfDomainFacade.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import { createClientActionAlertEffectEvent } from "../../protocol/client/ClientEffects.js";
import {
  isInteractionTimeoutClientCommand,
  parseInteractionTimeoutClientCommandEnvelope,
} from "../../protocol/client/ClientInteractionTimeoutProtocol.js";
import type { ClientCommandEnvelope } from "../../protocol/client/ClientProtocol.js";
import {
  isRoomRecoveryClientCommand,
  parseRoomRecoveryClientCommandEnvelope,
} from "../../protocol/client/ClientRecoveryProtocol.js";
import {
  isRoomManagementClientCommand,
  parseRoomManagementClientCommandEnvelope,
} from "../../protocol/client/ClientRoomManagementProtocol.js";
import {
  createClientRawWebSocketEventFrame,
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
  type ClientRawWebSocketRequest,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  isWerewolfLifecycleClientCommand,
  parseWerewolfLifecycleClientCommandEnvelope,
} from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import {
  parseWerewolfClientCommandEnvelope,
} from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import {
  createCloudflarePlayerStateEnvelope,
  createCloudflareRoomStateEnvelope,
  executeCloudflareClientProtocolCommand,
} from "./CloudflareClientProtocolAdapter.js";
import { pushCloudflareAuthoritativeStates } from "./CloudflareAuthoritativeStateDelivery.js";
import {
  emitCloudflareInteractionTimeoutActive,
  emitCloudflareInteractionTimeoutInactive,
} from "./CloudflareInteractionTimeoutDelivery.js";
import { CloudflareInteractionTimeoutRuntime } from "./CloudflareInteractionTimeoutRuntime.js";
import {
  emitCloudflareRoomClosed,
  emitCloudflareRoomRemoved,
} from "./CloudflareClientEventDelivery.js";
import { CloudflareRoomManagementRuntime } from "./CloudflareRoomManagementRuntime.js";
import { CloudflareRoomRecoveryRuntime } from "./CloudflareRoomRecoveryRuntime.js";
import {
  CloudflareRoomRealtime,
  type HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfCommandRuntime } from "./CloudflareWerewolfCommandRuntime.js";
import { CloudflareWerewolfLifecycleRuntime } from "./CloudflareWerewolfLifecycleRuntime.js";

type ClientSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  unknown
>;

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
  private readonly lifecycle: CloudflareWerewolfLifecycleRuntime;
  private readonly roomManagement: CloudflareRoomManagementRuntime;
  private readonly roomRecovery: CloudflareRoomRecoveryRuntime;
  private readonly interactionTimeouts: CloudflareInteractionTimeoutRuntime;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly realtime: CloudflareRoomRealtime,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository<ClientSnapshot>(storage);
    this.commands = new CloudflareWerewolfCommandRuntime(storage);
    this.lifecycle = new CloudflareWerewolfLifecycleRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
    this.roomManagement = new CloudflareRoomManagementRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
    this.roomRecovery = new CloudflareRoomRecoveryRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
    this.interactionTimeouts = new CloudflareInteractionTimeoutRuntime(storage);
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
      roomEnvelope: createCloudflareRoomStateEnvelope(
        snapshot,
        playerId,
        candidatePlayerId => this.realtime.isPlayerConnected(candidatePlayerId),
      ),
    };
    webSocket.send(encodeClientRawWebSocketFrame(
      createClientRawWebSocketSuccessResponse(requestId, result),
    ));

    const activeTimeout = await this.interactionTimeouts.activeStateForPlayer(
      snapshot,
      playerId,
    );
    if (activeTimeout) {
      emitCloudflareInteractionTimeoutActive(
        this.realtime,
        { ...activeTimeout, actorPlayerIds: [playerId] },
      );
    }
  }

  private async handleCommand(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    if (isInteractionTimeoutClientCommand(envelope)) {
      await this.handleInteractionTimeout(
        webSocket,
        playerId,
        requestId,
        envelope,
      );
      return;
    }

    if (isRoomRecoveryClientCommand(envelope)) {
      await this.handleRoomRecovery(
        webSocket,
        playerId,
        requestId,
        envelope,
      );
      return;
    }

    if (isRoomManagementClientCommand(envelope)) {
      await this.handleRoomManagement(
        webSocket,
        playerId,
        requestId,
        envelope,
      );
      return;
    }

    if (isWerewolfLifecycleClientCommand(envelope)) {
      try {
        const execution = await this.lifecycle.execute(
          playerId,
          parseWerewolfLifecycleClientCommandEnvelope(envelope),
        );
        webSocket.send(encodeClientRawWebSocketFrame(
          createClientRawWebSocketSuccessResponse(requestId, {
            revision: execution.revision,
            replayed: execution.replayed,
          }),
        ));
        if (!execution.replayed) {
          pushCloudflareAuthoritativeStates(this.realtime, execution.snapshot);
          await this.reconcileInteractionTimeout(execution.snapshot);
        }
      } catch (error) {
        this.sendFailure(
          webSocket,
          requestId,
          "command_failed",
          commandFailureMessage(error),
        );
      }
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
      if (!execution.replayed) {
        pushCloudflareAuthoritativeStates(this.realtime, execution.snapshot);
        if (execution.outcome.kind === "afterNightAction") {
          this.pushActionAlertEffect(execution.snapshot);
        }
        await this.reconcileInteractionTimeout(execution.snapshot);
      }
    } catch (error) {
      this.sendFailure(
        webSocket,
        requestId,
        "command_failed",
        commandFailureMessage(error),
      );
    }
  }

  private async handleInteractionTimeout(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseInteractionTimeoutClientCommandEnvelope(envelope);
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
      const execution = await this.interactionTimeouts.executeCommand(
        playerId,
        parsed,
      );
      if (!execution.result.ok) {
        this.sendFailure(
          webSocket,
          requestId,
          "command_failed",
          execution.result.message,
        );
        return;
      }

      if (execution.result.kind === "config") {
        webSocket.send(encodeClientRawWebSocketFrame(
          createClientRawWebSocketSuccessResponse(requestId, {
            replayed: execution.replayed,
            timeoutSeconds: execution.result.timeoutSeconds,
          }),
        ));
        return;
      }

      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(requestId, {
          replayed: execution.replayed,
          deadlineAt: execution.result.deadlineAt,
          canExtend: execution.result.canExtend,
        }),
      ));
      if (!execution.replayed && execution.active) {
        emitCloudflareInteractionTimeoutActive(
          this.realtime,
          execution.active,
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

  private async handleRoomRecovery(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseRoomRecoveryClientCommandEnvelope(envelope);
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
      const execution = await this.roomRecovery.execute(playerId, parsed);
      webSocket.send(encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(requestId, {
          revision: execution.revision,
          replayed: execution.replayed,
          outcome: execution.outcome,
        }),
      ));
      if (execution.replayed) return;

      if (execution.outcome.kind === "hostRecoveryReminder") {
        const frame = encodeClientRawWebSocketFrame(
          createClientRawWebSocketEventFrame(
            createClientActionAlertEffectEvent({
              actionId: execution.outcome.actionId,
              phase: execution.outcome.phase,
              resumed: true,
            }),
          ),
        );
        for (const actorPlayerId of execution.outcome.actorPlayerIds) {
          this.realtime.sendToPlayer(actorPlayerId, frame);
        }
        return;
      }

      pushCloudflareAuthoritativeStates(this.realtime, execution.snapshot);
      await this.reconcileInteractionTimeout(execution.snapshot);
    } catch (error) {
      this.sendFailure(
        webSocket,
        requestId,
        "command_failed",
        commandFailureMessage(error),
      );
    }
  }

  private async handleRoomManagement(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
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
        await this.interactionTimeouts.clearAll();
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

  private async reconcileInteractionTimeout(
    snapshot: ClientSnapshot,
  ): Promise<void> {
    const transition = await this.interactionTimeouts.reconcile(snapshot);
    if (transition.cleared && transition.previous) {
      emitCloudflareInteractionTimeoutInactive(
        this.realtime,
        transition.previous,
      );
    }
    if (transition.created && transition.active) {
      emitCloudflareInteractionTimeoutActive(
        this.realtime,
        transition.active,
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

  private pushActionAlertEffect(snapshot: ClientSnapshot): void {
    const interaction = snapshot.pendingInteraction;
    if (!interaction || interaction.status !== "active") return;

    const frame = createClientRawWebSocketEventFrame(
      createClientActionAlertEffectEvent({
        actionId: interaction.id,
        ...(snapshot.game?.phase === undefined ? {} : { phase: snapshot.game.phase }),
      }),
    );
    const encoded = encodeClientRawWebSocketFrame(frame);

    for (const playerId of interaction.actorPlayerIds) {
      try {
        this.realtime.sendToPlayer(playerId, encoded);
      } catch {
        // Transient action alerts are best-effort. Authoritative state remains
        // recoverable through the state push / explicit sync path.
      }
    }
  }

}
