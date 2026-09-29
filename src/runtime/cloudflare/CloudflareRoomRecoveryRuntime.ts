import type { CommandReceipt } from "../../core/command/IdempotentCommandLedger.js";
import { RoomCommandRuntime } from "../../core/room/RoomCommandRuntime.js";
import {
  createRoomSnapshot,
  nextRoomRevision,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import {
  mapRoomRecoveryClientCommand,
  type RoomRecoveryClientCommandEnvelope,
} from "../../protocol/client/ClientRecoveryProtocol.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  assertRoomRecoveryAuthority,
  executeRoomRecoveryCommand,
  type RoomRecoveryCommandOutcome,
} from "../shared/roomRecoveryCommand.js";
import { getActiveWerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

type RoomReceipt = CommandReceipt<unknown>;

type RecoverySnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  RoomReceipt
>;

type RecoveryRoom = RoomState<GameState, GameConfig, RoomPlayer> & {
  commandReceipts?: RoomReceipt[];
};

export type CloudflareRoomRecoveryExecution = {
  outcome: RoomRecoveryCommandOutcome;
  replayed: boolean;
  revision: number;
  snapshot: RecoverySnapshot;
};

export type CloudflareRoomRecoveryDependencies = {
  isPlayerConnected(playerId: string): boolean;
  now?: () => number;
};

const OWNER_SCOPE = "room-owner";

export class CloudflareRoomRecoveryRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository<RecoverySnapshot>;
  private readonly commands = new RoomCommandRuntime<unknown, RecoveryRoom>();
  private readonly now: () => number;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly dependencies: CloudflareRoomRecoveryDependencies,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository(storage);
    this.now = dependencies.now ?? Date.now;
  }

  async execute(
    authenticatedPlayerId: string,
    envelope: RoomRecoveryClientCommandEnvelope,
  ): Promise<CloudflareRoomRecoveryExecution> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room snapshot not found");
    if (snapshot.metadata.gameType !== "werewolf") {
      throw new Error(`unsupported game type: ${snapshot.metadata.gameType}`);
    }

    const restored = restoreRoomSnapshot(snapshot);
    const room: RecoveryRoom = {
      ...restored.room,
      ...(restored.commandReceipts === undefined
        ? {}
        : {
            commandReceipts: restored.commandReceipts.map(receipt => ({
              ...receipt,
            })),
          }),
    };
    const mapped = mapRoomRecoveryClientCommand(envelope);
    // Authority must be checked before RoomCommandRuntime replay lookup so a
    // non-host cannot reuse a previously accepted host commandId.
    assertRoomRecoveryAuthority(
      room,
      authenticatedPlayerId,
      mapped.command,
    );

    const execution = await this.commands.execute(
      room,
      OWNER_SCOPE,
      mapped.commandId,
      () =>
        executeRoomRecoveryCommand(
          room,
          authenticatedPlayerId,
          mapped.command,
          {
            isPlayerConnected: playerId =>
              this.dependencies.isPlayerConnected(playerId),
            now: this.now,
          },
        ),
      mapped.command.type === "recovery.abortToLobby"
        ? { resetReceiptHistory: true }
        : undefined,
    );

    if (execution.replayed) {
      return {
        outcome: execution.outcome as RoomRecoveryCommandOutcome,
        replayed: true,
        revision: snapshot.revision,
        snapshot,
      };
    }

    const pendingInteraction = room.game
      ? getActiveWerewolfInteraction(room.game)
      : undefined;
    const revision = nextRoomRevision(snapshot.revision);
    const nextSnapshot = createRoomSnapshot(room, {
      revision,
      ...(execution.outcome.kind === "abortedToLobby" ||
      snapshot.ruleState === undefined
        ? {}
        : { ruleState: snapshot.ruleState }),
      ...(pendingInteraction === undefined
        ? {}
        : { pendingInteraction }),
      ...(room.commandReceipts === undefined
        ? {}
        : { commandReceipts: room.commandReceipts }),
    }) as RecoverySnapshot;

    await this.snapshots.save(nextSnapshot);
    return {
      outcome: execution.outcome as RoomRecoveryCommandOutcome,
      replayed: false,
      revision,
      snapshot: nextSnapshot,
    };
  }
}
