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
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  mapRoomManagementClientCommand,
  type RoomManagementClientCommandEnvelope,
} from "../../protocol/client/ClientRoomManagementProtocol.js";
import {
  executeRoomManagementMutation,
  type RoomManagementCommandOutcome,
} from "../shared/roomManagementCommand.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

type RoomReceipt = CommandReceipt<unknown>;

export type CloudflareRoomManagementSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  RoomReceipt
>;

type ManagementRoom = RoomState<GameState, GameConfig, RoomPlayer> & {
  commandReceipts?: RoomReceipt[];
};

export type CloudflareRoomManagementExecution = {
  outcome: RoomManagementCommandOutcome;
  replayed: boolean;
  revision: number;
  snapshot?: CloudflareRoomManagementSnapshot;
  roomCleared: boolean;
};

export type CloudflareRoomManagementDependencies = {
  isPlayerConnected(playerId: string): boolean;
};

export class CloudflareRoomManagementRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository<
    CloudflareRoomManagementSnapshot
  >;
  private readonly commands = new RoomCommandRuntime<unknown, ManagementRoom>();

  constructor(
    storage: DurableObjectStorageLike,
    private readonly dependencies: CloudflareRoomManagementDependencies,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository(storage);
  }

  async execute(
    authenticatedPlayerId: string,
    envelope: RoomManagementClientCommandEnvelope,
  ): Promise<CloudflareRoomManagementExecution> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room snapshot not found");

    const restored = restoreRoomSnapshot(snapshot);
    const room: ManagementRoom = {
      ...restored.room,
      ...(restored.commandReceipts === undefined
        ? {}
        : {
            commandReceipts: restored.commandReceipts.map(receipt => ({
              ...receipt,
            })),
          }),
    };
    const mapped = mapRoomManagementClientCommand(envelope);

    const execution = await this.commands.execute(
      room,
      `player:${authenticatedPlayerId}`,
      mapped.commandId,
      () => executeRoomManagementMutation(
        room,
        authenticatedPlayerId,
        mapped.command,
        this.dependencies,
      ),
    );

    const outcome = execution.outcome as RoomManagementCommandOutcome;
    if (execution.replayed) {
      return {
        outcome,
        replayed: true,
        revision: snapshot.revision,
        snapshot,
        roomCleared: false,
      };
    }

    if (
      outcome.kind === "closedRoom" ||
      (outcome.kind === "leftRoom" && outcome.roomEmpty)
    ) {
      await this.snapshots.clear();
      return {
        outcome,
        replayed: false,
        revision: nextRoomRevision(snapshot.revision),
        roomCleared: true,
      };
    }

    const revision = nextRoomRevision(snapshot.revision);
    const nextSnapshot = createRoomSnapshot(room, {
      revision,
      ...(snapshot.ruleState === undefined
        ? {}
        : { ruleState: snapshot.ruleState }),
      ...(snapshot.pendingInteraction === undefined
        ? {}
        : { pendingInteraction: snapshot.pendingInteraction }),
      ...(room.commandReceipts === undefined
        ? {}
        : { commandReceipts: room.commandReceipts }),
    }) as CloudflareRoomManagementSnapshot;

    await this.snapshots.save(nextSnapshot);
    return {
      outcome,
      replayed: false,
      revision,
      snapshot: nextSnapshot,
      roomCleared: false,
    };
  }
}
