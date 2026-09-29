import {
  createRoomSnapshot,
  nextRoomRevision,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import { hasGameModeratorControl } from "../../core/room/GameModerator.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import {
  isTimedWerewolfInteraction,
  recoverTimedOutWerewolfInteraction,
} from "../../games/werewolf/WerewolfTimeoutRecovery.js";
import {
  getActiveWerewolfInteraction,
  type WerewolfInteraction,
} from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  mapInteractionTimeoutClientCommand,
  type InteractionTimeoutClientCommandEnvelope,
} from "../../protocol/client/ClientInteractionTimeoutProtocol.js";
import {
  createInteractionTimeoutState,
  extendInteractionTimeout,
  markInteractionTimeoutWarning,
  normalizeInteractionTimeoutSeconds,
  type InteractionTimeoutState,
} from "../shared/interactionTimeoutPolicy.js";
import { executeWerewolfRoomCommand } from "../shared/werewolfRoomCommand.js";
import {
  CloudflareInteractionTimeoutRepository,
  type CloudflareInteractionTimeoutState,
  type InteractionTimeoutCommandResult,
} from "./CloudflareInteractionTimeoutRepository.js";
import { CloudflareRandomProvider } from "./CloudflareRandomProvider.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

type TimeoutSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  unknown
>;

type TimeoutRoom = RoomState<GameState, GameConfig, RoomPlayer>;

export type InteractionTimeoutReconcileResult = {
  previous?: InteractionTimeoutState;
  active?: InteractionTimeoutState;
  created: boolean;
  cleared: boolean;
};

export type CloudflareInteractionTimeoutCommandExecution = {
  result: InteractionTimeoutCommandResult;
  replayed: boolean;
  active?: InteractionTimeoutState;
};

export type CloudflareInteractionTimeoutAlarmResult =
  | { kind: "none" }
  | { kind: "warning"; state: InteractionTimeoutState }
  | {
      kind: "recovered";
      previous: InteractionTimeoutState;
      snapshot: TimeoutSnapshot;
      next: InteractionTimeoutReconcileResult;
    }
  | {
      kind: "error";
      previous: InteractionTimeoutState;
      message: string;
    }
  | {
      kind: "reconciled";
      transition: InteractionTimeoutReconcileResult;
    };

function moderatorAuthority(
  snapshot: TimeoutSnapshot,
  playerId: string,
  message: string,
): void {
  const member = snapshot.membership.find(item => item.id === playerId);
  if (!member || !hasGameModeratorControl(snapshot.gameModerator, member)) {
    throw new Error(message);
  }
}

function memberAuthority(snapshot: TimeoutSnapshot, playerId: string): void {
  if (!snapshot.membership.some(item => item.id === playerId)) {
    throw new Error("你当前不在房间中");
  }
}

function receiptKey(scope: string, commandId: string): string {
  return `${scope}:${commandId}`;
}

function currentInteraction(snapshot: TimeoutSnapshot): WerewolfInteraction | undefined {
  if (!snapshot.game || !isTimedWerewolfInteraction(snapshot.game)) {
    return undefined;
  }
  // Re-derive from authoritative game state instead of trusting a persisted
  // pendingInteraction that could lag behind the current actionId.
  return getActiveWerewolfInteraction(snapshot.game);
}

export class CloudflareInteractionTimeoutRuntime {
  private readonly repository: CloudflareInteractionTimeoutRepository;
  private readonly snapshots: CloudflareRoomSnapshotRepository<TimeoutSnapshot>;
  private readonly random = new CloudflareRandomProvider();

  constructor(
    private readonly storage: DurableObjectStorageLike,
    private readonly now: () => number = Date.now,
  ) {
    this.repository = new CloudflareInteractionTimeoutRepository(storage);
    this.snapshots = new CloudflareRoomSnapshotRepository<TimeoutSnapshot>(storage);
  }

  async executeCommand(
    authenticatedPlayerId: string,
    envelope: InteractionTimeoutClientCommandEnvelope,
  ): Promise<CloudflareInteractionTimeoutCommandExecution> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room snapshot not found");
    const mapped = mapInteractionTimeoutClientCommand(envelope);
    const state = await this.repository.load();

    if (mapped.command.type === "interactionTimeout.getConfig") {
      moderatorAuthority(snapshot, authenticatedPlayerId, "只有主持人可以查看超时设置");
      return {
        result: {
          ok: true,
          kind: "config",
          timeoutSeconds: state.timeoutSeconds,
        },
        replayed: false,
      };
    }

    if (mapped.command.type === "interactionTimeout.setConfig") {
      moderatorAuthority(snapshot, authenticatedPlayerId, "只有主持人可以修改超时设置");
      const key = receiptKey(`moderator:${authenticatedPlayerId}`, mapped.commandId);
      const replay = this.repository.findReceipt(state, key);
      if (replay) return { result: replay, replayed: true };

      let result: InteractionTimeoutCommandResult;
      if (snapshot.game) {
        result = { ok: false, message: "游戏开始后不能修改行动超时" };
      } else {
        state.timeoutSeconds = normalizeInteractionTimeoutSeconds(
          mapped.command.timeoutSeconds,
        );
        delete state.active;
        result = {
          ok: true,
          kind: "config",
          timeoutSeconds: state.timeoutSeconds,
        };
        await this.deleteAlarm();
      }
      this.repository.rememberReceipt(state, key, result);
      await this.repository.save(state);
      return { result, replayed: false };
    }

    memberAuthority(snapshot, authenticatedPlayerId);
    const key = receiptKey(`player:${authenticatedPlayerId}`, mapped.commandId);
    const replay = this.repository.findReceipt(state, key);
    if (replay) {
      return {
        result: replay,
        replayed: true,
        ...(replay.ok && replay.kind === "extended" && state.active
          ? { active: state.active }
          : {}),
      };
    }

    const extended = extendInteractionTimeout(
      state.active,
      mapped.command.actionId,
      authenticatedPlayerId,
      this.now(),
    );
    let result: InteractionTimeoutCommandResult;
    if (!extended.ok) {
      result = { ok: false, message: extended.message };
    } else {
      state.active = extended.state;
      result = {
        ok: true,
        kind: "extended",
        deadlineAt: extended.state.deadlineAt,
        canExtend: false,
      };
    }

    this.repository.rememberReceipt(state, key, result);
    await this.repository.save(state);
    if (extended.ok) await this.scheduleNext(extended.state);
    return {
      result,
      replayed: false,
      ...(extended.ok ? { active: extended.state } : {}),
    };
  }

  async reconcile(
    snapshot: TimeoutSnapshot,
    now: number = this.now(),
  ): Promise<InteractionTimeoutReconcileResult> {
    const state = await this.repository.load();
    const previous = state.active;
    const interaction = currentInteraction(snapshot);

    if (!interaction || state.timeoutSeconds <= 0) {
      if (previous) {
        delete state.active;
        await this.repository.save(state);
      }
      await this.deleteAlarm();
      return {
        ...(previous === undefined ? {} : { previous }),
        created: false,
        cleared: previous !== undefined,
      };
    }

    if (previous?.actionId === interaction.id) {
      await this.scheduleNext(previous, now);
      return { active: previous, created: false, cleared: false };
    }

    const active = createInteractionTimeoutState(
      snapshot.metadata.roomId,
      interaction.id,
      interaction.actorPlayerIds,
      now,
      state.timeoutSeconds,
    );
    if (!active) {
      if (previous) {
        delete state.active;
        await this.repository.save(state);
      }
      await this.deleteAlarm();
      return {
        ...(previous === undefined ? {} : { previous }),
        created: false,
        cleared: previous !== undefined,
      };
    }

    state.active = active;
    await this.repository.save(state);
    await this.scheduleNext(active, now);
    return {
      ...(previous === undefined ? {} : { previous }),
      active,
      created: true,
      cleared: previous !== undefined,
    };
  }

  async activeStateForPlayer(
    snapshot: TimeoutSnapshot,
    playerId: string,
  ): Promise<InteractionTimeoutState | undefined> {
    const state = await this.repository.load();
    const active = state.active;
    if (!active) return undefined;
    if (!active.actorPlayerIds.includes(playerId)) return undefined;
    if (snapshot.game?.actionId !== active.actionId) return undefined;
    return active;
  }

  async clearAll(): Promise<void> {
    await this.repository.clear();
    await this.deleteAlarm();
  }

  async handleAlarm(): Promise<CloudflareInteractionTimeoutAlarmResult> {
    const state = await this.repository.load();
    const active = state.active;
    if (!active) {
      await this.deleteAlarm();
      return { kind: "none" };
    }

    const snapshot = await this.snapshots.load();
    if (!snapshot) {
      delete state.active;
      await this.repository.save(state);
      await this.deleteAlarm();
      return {
        kind: "reconciled",
        transition: {
          previous: active,
          created: false,
          cleared: true,
        },
      };
    }

    const interaction = currentInteraction(snapshot);
    if (
      !interaction ||
      interaction.id !== active.actionId ||
      snapshot.game?.actionId !== active.actionId
    ) {
      return {
        kind: "reconciled",
        transition: await this.reconcile(snapshot),
      };
    }

    const now = this.now();
    if (now >= active.deadlineAt) {
      return this.expire(snapshot, state, active, now);
    }

    if (now >= active.warningAt && !active.warningSent) {
      const warned = markInteractionTimeoutWarning(active, active.actionId);
      if (!warned) return { kind: "none" };
      state.active = warned;
      await this.repository.save(state);
      await this.scheduleNext(warned, now);
      return { kind: "warning", state: warned };
    }

    await this.scheduleNext(active, now);
    return { kind: "none" };
  }

  private async expire(
    snapshot: TimeoutSnapshot,
    timeoutState: CloudflareInteractionTimeoutState,
    active: InteractionTimeoutState,
    now: number,
  ): Promise<CloudflareInteractionTimeoutAlarmResult> {
    const restored = restoreRoomSnapshot(snapshot);
    const room = restored.room as TimeoutRoom;

    try {
      if (!room.game) {
        return {
          kind: "reconciled",
          transition: await this.reconcile(snapshot, now),
        };
      }

      const recovered = recoverTimedOutWerewolfInteraction(
        room.game,
        active.actionId,
        this.random,
      );
      if (!recovered.recovered) {
        return {
          kind: "reconciled",
          transition: await this.reconcile(snapshot, now),
        };
      }

      room.updatedAt = now;
      if (room.game.phase === "night_complete") {
        executeWerewolfRoomCommand(
          room,
          { type: "startDayVote" },
          { isModerator: true },
          { random: this.random, now: () => now },
        );
      }

      const pendingInteraction = room.game
        ? getActiveWerewolfInteraction(room.game)
        : undefined;
      const nextSnapshot = createRoomSnapshot(room, {
        revision: nextRoomRevision(snapshot.revision),
        ...(snapshot.ruleState === undefined
          ? {}
          : { ruleState: snapshot.ruleState }),
        ...(pendingInteraction === undefined
          ? {}
          : { pendingInteraction }),
        ...(restored.commandReceipts === undefined
          ? {}
          : { commandReceipts: restored.commandReceipts }),
      }) as TimeoutSnapshot;

      await this.snapshots.save(nextSnapshot);
      delete timeoutState.active;
      await this.repository.save(timeoutState);
      await this.deleteAlarm();
      const next = await this.reconcile(nextSnapshot, now);
      return {
        kind: "recovered",
        previous: active,
        snapshot: nextSnapshot,
        next,
      };
    } catch (error) {
      delete timeoutState.active;
      await this.repository.save(timeoutState);
      await this.deleteAlarm();
      return {
        kind: "error",
        previous: active,
        message:
          error instanceof Error && error.message
            ? error.message
            : "行动超时恢复失败",
      };
    }
  }

  private async scheduleNext(
    state: InteractionTimeoutState,
    now: number = this.now(),
  ): Promise<void> {
    if (!this.storage.setAlarm) return;
    const target = state.warningSent ? state.deadlineAt : state.warningAt;
    await this.storage.setAlarm(Math.max(now, target));
  }

  private async deleteAlarm(): Promise<void> {
    if (this.storage.deleteAlarm) await this.storage.deleteAlarm();
  }
}
