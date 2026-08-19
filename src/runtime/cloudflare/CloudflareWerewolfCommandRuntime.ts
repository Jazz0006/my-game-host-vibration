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
import type { WerewolfCommand } from "../../games/werewolf/WerewolfGameModule.js";
import {
  getActiveWerewolfInteraction,
  type WerewolfInteraction,
} from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  executeWerewolfRoomCommand,
  type WerewolfCommandActor,
  type WerewolfCommandEnvironment,
  type WerewolfCommandOutcome,
} from "../shared/werewolfRoomCommand.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareRandomProvider } from "./CloudflareRandomProvider.js";

type WerewolfReceipt = CommandReceipt<WerewolfCommandOutcome>;

type WerewolfSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  WerewolfReceipt
>;

type CloudflareWerewolfRoom = RoomState<GameState, GameConfig, RoomPlayer> & {
  commandReceipts?: WerewolfReceipt[];
};

export type CloudflareWerewolfCommandExecution = {
  outcome: WerewolfCommandOutcome;
  replayed: boolean;
  revision: number;
  snapshot: WerewolfSnapshot;
};

const HOST_SCOPE = "host";

function playerScope(playerId: string): string {
  return `player:${playerId}`;
}

function defaultEnvironment(): WerewolfCommandEnvironment {
  return {
    random: new CloudflareRandomProvider(),
    now: Date.now,
  };
}

/**
 * D5 Cloudflare authoritative command path.
 *
 * A command starts from the persisted D3 RoomSnapshot, restores a
 * transport-neutral room, executes through the same RoomCommandRuntime and
 * Werewolf executor used by Node, then persists the next authoritative
 * snapshot. Duplicate commandId delivery returns the stored outcome without
 * advancing revision or mutating game state again.
 */
export class CloudflareWerewolfCommandRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository<WerewolfSnapshot>;
  private readonly commands = new RoomCommandRuntime<
    WerewolfCommandOutcome,
    CloudflareWerewolfRoom
  >();

  constructor(
    storage: DurableObjectStorageLike,
    private readonly environment: WerewolfCommandEnvironment = defaultEnvironment(),
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository<WerewolfSnapshot>(storage);
  }

  executePlayer(
    playerId: string,
    commandId: string,
    command: WerewolfCommand,
  ): Promise<CloudflareWerewolfCommandExecution> {
    return this.execute(playerScope(playerId), { playerId }, commandId, command, playerId);
  }

  executeHost(
    hostPlayerId: string,
    commandId: string,
    command: WerewolfCommand,
  ): Promise<CloudflareWerewolfCommandExecution> {
    return this.execute(HOST_SCOPE, { isHost: true }, commandId, command, hostPlayerId, true);
  }

  private async execute(
    scope: string,
    actor: WerewolfCommandActor,
    commandId: string,
    command: WerewolfCommand,
    authenticatedPlayerId: string,
    requireHost = false,
  ): Promise<CloudflareWerewolfCommandExecution> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room snapshot not found");
    if (snapshot.metadata.gameType !== "werewolf") {
      throw new Error(`unsupported game type: ${snapshot.metadata.gameType}`);
    }

    const member = snapshot.membership.find(item => item.id === authenticatedPlayerId);
    if (!member) throw new Error("authenticated player is not a room member");
    if (requireHost && !member.isHost) throw new Error("host command requires host authority");

    const restored = restoreRoomSnapshot(snapshot);
    const room: CloudflareWerewolfRoom = {
      ...restored.room,
      ...(restored.commandReceipts === undefined
        ? {}
        : { commandReceipts: restored.commandReceipts.map(receipt => ({ ...receipt })) }),
    };

    const execution = await this.commands.execute(
      room,
      scope,
      commandId,
      () => executeWerewolfRoomCommand(room, command, actor, this.environment),
    );

    if (execution.replayed) {
      return {
        outcome: execution.outcome,
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
      ...(snapshot.ruleState === undefined ? {} : { ruleState: snapshot.ruleState }),
      ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
      ...(room.commandReceipts === undefined
        ? {}
        : { commandReceipts: room.commandReceipts }),
    }) as WerewolfSnapshot;

    await this.snapshots.save(nextSnapshot);
    return {
      outcome: execution.outcome,
      replayed: false,
      revision,
      snapshot: nextSnapshot,
    };
  }
}
