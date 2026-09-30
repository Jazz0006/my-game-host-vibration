import type { CommandReceipt } from "../../core/command/IdempotentCommandLedger.js";
import { RoomCommandRuntime } from "../../core/room/RoomCommandRuntime.js";
import {
  gameParticipantPlayers,
  hasGameModeratorControl,
} from "../../core/room/GameModerator.js";
import {
  createRoomSnapshot,
  nextRoomRevision,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import {
  botcGameModule,
  type BotcGameConfig,
  type BotcGameState,
} from "../../games/botc/BotcGameModule.js";
import {
  TROUBLE_BREWING_SCRIPT_ID,
} from "../../games/botc/TroubleBrewing.js";
import {
  createTroubleBrewingAutomaticSetup,
} from "../../games/botc/TroubleBrewingAutomaticSetup.js";
import type {
  BotcClientCommandEnvelope,
} from "../../protocol/client/BotcClientProtocol.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareRandomProvider } from "./CloudflareRandomProvider.js";
import type { RandomProvider } from "../../core/random/RandomProvider.js";

type RoomReceipt = CommandReceipt<unknown>;

type BotcSnapshot = RoomSnapshot<
  BotcGameState,
  BotcGameConfig,
  unknown,
  unknown,
  RoomReceipt
>;

type CloudflareBotcRoom = RoomState<
  BotcGameState,
  BotcGameConfig,
  RoomPlayer
> & {
  commandReceipts?: RoomReceipt[];
};

export type CloudflareBotcCommandEnvironment = {
  random: RandomProvider;
  now(): number;
};

export type CloudflareBotcCommandExecution = {
  outcome: { kind: "gameStarted" };
  replayed: boolean;
  revision: number;
  snapshot: BotcSnapshot;
};

export type CloudflareBotcCommandDependencies = {
  isPlayerConnected(playerId: string): boolean;
  environment?: CloudflareBotcCommandEnvironment;
};

const MODERATOR_SCOPE = "game-moderator";

function defaultEnvironment(): CloudflareBotcCommandEnvironment {
  return {
    random: new CloudflareRandomProvider(),
    now: Date.now,
  };
}

export class CloudflareBotcCommandRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository<BotcSnapshot>;
  private readonly commands =
    new RoomCommandRuntime<unknown, CloudflareBotcRoom>();
  private readonly environment: CloudflareBotcCommandEnvironment;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly dependencies: CloudflareBotcCommandDependencies,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository<BotcSnapshot>(storage);
    this.environment = dependencies.environment ?? defaultEnvironment();
  }

  async execute(
    authenticatedPlayerId: string,
    envelope: BotcClientCommandEnvelope,
  ): Promise<CloudflareBotcCommandExecution> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room snapshot not found");
    if (snapshot.metadata.gameType !== "botc") {
      throw new Error(`unsupported game type: ${snapshot.metadata.gameType}`);
    }

    const member = snapshot.membership.find(
      item => item.id === authenticatedPlayerId,
    );
    if (!member) throw new Error("authenticated player is not a room member");
    if (!hasGameModeratorControl(snapshot.gameModerator, member)) {
      throw new Error("game command requires moderator authority");
    }

    const restored = restoreRoomSnapshot(snapshot);
    const room: CloudflareBotcRoom = {
      ...restored.room,
      ...(restored.commandReceipts === undefined
        ? {}
        : {
            commandReceipts: restored.commandReceipts.map(
              receipt => ({ ...receipt }),
            ),
          }),
    };

    const execution = await this.commands.execute(
      room,
      MODERATOR_SCOPE,
      envelope.commandId,
      () => this.startGame(room),
      { resetReceiptHistory: true },
    );

    if (execution.replayed) {
      return {
        outcome: execution.outcome as { kind: "gameStarted" },
        replayed: true,
        revision: snapshot.revision,
        snapshot,
      };
    }

    const revision = nextRoomRevision(snapshot.revision);
    const nextSnapshot = createRoomSnapshot(room, {
      revision,
      ...(snapshot.ruleState === undefined
        ? {}
        : { ruleState: snapshot.ruleState }),
      ...(room.commandReceipts === undefined
        ? {}
        : { commandReceipts: room.commandReceipts }),
    }) as BotcSnapshot;

    await this.snapshots.save(nextSnapshot);
    return {
      outcome: execution.outcome as { kind: "gameStarted" },
      replayed: false,
      revision,
      snapshot: nextSnapshot,
    };
  }

  private startGame(
    room: CloudflareBotcRoom,
  ): { kind: "gameStarted" } {
    if (room.game) throw new Error("BotC game already started");

    const participants = gameParticipantPlayers(room);
    if (participants.length < 5 || participants.length > 15) {
      throw new Error("Trouble Brewing requires 5–15 players");
    }
    if (
      participants.some(
        player => !this.dependencies.isPlayerConnected(player.id),
      )
    ) {
      throw new Error("all BotC players must be online before starting");
    }

    const playerIds = participants.map(player => player.id);
    const assignments = createTroubleBrewingAutomaticSetup(
      playerIds,
      this.environment.random,
    );
    const config: BotcGameConfig = {
      scriptId: TROUBLE_BREWING_SCRIPT_ID,
    };
    room.gameConfig = config;
    room.game = botcGameModule.createGame(
      {
        playerIds,
        config,
        assignments,
      },
      { random: this.environment.random },
    );
    room.updatedAt = this.environment.now();

    return { kind: "gameStarted" };
  }
}
