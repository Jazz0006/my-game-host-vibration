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
  createClientRawWebSocketEventFrame,
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  isWerewolfLifecycleClientCommand,
  parseWerewolfLifecycleClientCommandEnvelope,
} from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import {
  parseWerewolfClientCommandEnvelope,
} from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import {
  executeCloudflareClientProtocolCommand,
} from "./CloudflareClientProtocolAdapter.js";
import { pushCloudflareAuthoritativeStates } from "./CloudflareAuthoritativeStateDelivery.js";
import {
  emitCloudflareInteractionTimeoutActive,
  emitCloudflareInteractionTimeoutInactive,
} from "./CloudflareInteractionTimeoutDelivery.js";
import { CloudflareInteractionTimeoutRuntime } from "./CloudflareInteractionTimeoutRuntime.js";
import { CloudflareRoomRecoveryRuntime } from "./CloudflareRoomRecoveryRuntime.js";
import type {
  CloudflareRoomRealtime,
  HibernationWebSocketLike,
} from "./CloudflareRoomRealtime.js";
import type { DurableObjectStorageLike } from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfCommandRuntime } from "./CloudflareWerewolfCommandRuntime.js";
import { CloudflareWerewolfLifecycleRuntime } from "./CloudflareWerewolfLifecycleRuntime.js";
import type { CloudflareGameCommandHandler } from "./CloudflareGameCommandRuntimeRegistry.js";

type WerewolfClientSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  unknown
>;

function asWerewolfSnapshot(snapshot: RoomSnapshot): WerewolfClientSnapshot {
  if (snapshot.metadata.gameType !== "werewolf") {
    throw new Error(`unsupported game type: ${snapshot.metadata.gameType}`);
  }
  return snapshot as WerewolfClientSnapshot;
}

function commandFailureMessage(error: unknown): string {
  return error instanceof GameRuleError ? error.message : "操作失败，请重试";
}

export class CloudflareWerewolfGameCommandHandler implements CloudflareGameCommandHandler {
  private readonly commands: CloudflareWerewolfCommandRuntime;
  private readonly lifecycle: CloudflareWerewolfLifecycleRuntime;
  private readonly roomRecovery: CloudflareRoomRecoveryRuntime;
  private readonly interactionTimeouts: CloudflareInteractionTimeoutRuntime;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly realtime: CloudflareRoomRealtime,
  ) {
    this.commands = new CloudflareWerewolfCommandRuntime(storage);
    this.lifecycle = new CloudflareWerewolfLifecycleRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
    this.roomRecovery = new CloudflareRoomRecoveryRuntime(storage, {
      isPlayerConnected: playerId => realtime.isPlayerConnected(playerId),
    });
    this.interactionTimeouts = new CloudflareInteractionTimeoutRuntime(storage);
  }

  async handleSync(playerId: string, snapshot: RoomSnapshot): Promise<void> {
    const activeTimeout = await this.interactionTimeouts.activeStateForPlayer(
      asWerewolfSnapshot(snapshot),
      playerId,
    );
    if (activeTimeout) {
      emitCloudflareInteractionTimeoutActive(
        this.realtime,
        { ...activeTimeout, actorPlayerIds: [playerId] },
      );
    }
  }

  async handleCommand(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
    if (isInteractionTimeoutClientCommand(envelope)) {
      await this.handleInteractionTimeout(webSocket, playerId, requestId, envelope);
      return;
    }

    if (isRoomRecoveryClientCommand(envelope)) {
      await this.handleRoomRecovery(webSocket, playerId, requestId, envelope);
      return;
    }

    if (isWerewolfLifecycleClientCommand(envelope)) {
      await this.handleLifecycle(webSocket, playerId, requestId, envelope);
      return;
    }

    await this.handleGameplay(webSocket, playerId, requestId, envelope);
  }

  clearRoomRuntimeState(): Promise<void> {
    return this.interactionTimeouts.clearAll();
  }

  private async handleLifecycle(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
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
      this.sendFailure(webSocket, requestId, "command_failed", commandFailureMessage(error));
    }
  }

  private async handleGameplay(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void> {
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
      this.sendFailure(webSocket, requestId, "command_failed", commandFailureMessage(error));
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
      const execution = await this.interactionTimeouts.executeCommand(playerId, parsed);
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
        emitCloudflareInteractionTimeoutActive(this.realtime, execution.active);
      }
    } catch (error) {
      this.sendFailure(
        webSocket,
        requestId,
        "command_failed",
        error instanceof Error && error.message ? error.message : "操作失败，请重试",
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
      this.sendFailure(webSocket, requestId, "command_failed", commandFailureMessage(error));
    }
  }

  private async reconcileInteractionTimeout(
    snapshot: WerewolfClientSnapshot,
  ): Promise<void> {
    const transition = await this.interactionTimeouts.reconcile(snapshot);
    if (transition.cleared && transition.previous) {
      emitCloudflareInteractionTimeoutInactive(this.realtime, transition.previous);
    }
    if (transition.created && transition.active) {
      emitCloudflareInteractionTimeoutActive(this.realtime, transition.active);
    }
  }

  private pushActionAlertEffect(snapshot: WerewolfClientSnapshot): void {
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
        // recoverable through state push / explicit sync.
      }
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
