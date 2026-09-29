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
  configFromPlayerCount,
  configFromRoleDeck,
  GameRuleError,
  type GameConfig,
  type GameState,
} from "../../games/werewolf/WerewolfDomainFacade.js";
import { werewolfGameModule } from "../../games/werewolf/WerewolfGameModule.js";
import {
  WEREWOLF_MAX_PLAYERS,
  WEREWOLF_MIN_PLAYERS,
  isWerewolfPlayerCountSupported,
} from "../../games/werewolf/WerewolfLobbyPolicy.js";
import {
  getActiveWerewolfInteraction,
  type WerewolfInteraction,
} from "../../games/werewolf/WerewolfNightPlanner.js";
import type { WerewolfLifecycleClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import type { WerewolfCommandEnvironment } from "../shared/werewolfRoomCommand.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareRandomProvider } from "./CloudflareRandomProvider.js";

type RoomReceipt = CommandReceipt<unknown>;

type WerewolfSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  RoomReceipt
>;

type LifecycleRoom = RoomState<GameState, GameConfig, RoomPlayer> & {
  commandReceipts?: RoomReceipt[];
};

type LifecycleOutcome = { kind: "broadcast" };

export type CloudflareWerewolfLifecycleExecution = {
  outcome: LifecycleOutcome;
  replayed: boolean;
  revision: number;
  snapshot: WerewolfSnapshot;
};

export type CloudflareWerewolfLifecycleDependencies = {
  isPlayerConnected(playerId: string): boolean;
  environment?: WerewolfCommandEnvironment;
};

const MODERATOR_SCOPE = "game-moderator";

function defaultEnvironment(): WerewolfCommandEnvironment {
  return {
    random: new CloudflareRandomProvider(),
    now: Date.now,
  };
}

export class CloudflareWerewolfLifecycleRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository<WerewolfSnapshot>;
  private readonly commands = new RoomCommandRuntime<unknown, LifecycleRoom>();
  private readonly environment: WerewolfCommandEnvironment;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly dependencies: CloudflareWerewolfLifecycleDependencies,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository<WerewolfSnapshot>(storage);
    this.environment = dependencies.environment ?? defaultEnvironment();
  }

  async execute(
    authenticatedPlayerId: string,
    envelope: WerewolfLifecycleClientCommandEnvelope,
  ): Promise<CloudflareWerewolfLifecycleExecution> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room snapshot not found");
    if (snapshot.metadata.gameType !== "werewolf") {
      throw new Error(`unsupported game type: ${snapshot.metadata.gameType}`);
    }

    const member = snapshot.membership.find(item => item.id === authenticatedPlayerId);
    if (!member) throw new Error("authenticated player is not a room member");
    if (!hasGameModeratorControl(snapshot.gameModerator, member)) {
      throw new Error("game command requires moderator authority");
    }

    const restored = restoreRoomSnapshot(snapshot);
    const room: LifecycleRoom = {
      ...restored.room,
      ...(restored.commandReceipts === undefined
        ? {}
        : { commandReceipts: restored.commandReceipts.map(receipt => ({ ...receipt })) }),
    };

    const execution = await this.commands.execute(
      room,
      MODERATOR_SCOPE,
      envelope.commandId,
      () => this.mutate(room, envelope),
      { resetReceiptHistory: true },
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

  private mutate(
    room: LifecycleRoom,
    envelope: WerewolfLifecycleClientCommandEnvelope,
  ): LifecycleOutcome {
    const participants = gameParticipantPlayers(room);
    if (envelope.type === "werewolf.startGame") {
      if (room.game) throw new GameRuleError("游戏已经开始");
      if (!isWerewolfPlayerCountSupported(participants.length)) {
        throw new GameRuleError(
          `需要${WEREWOLF_MIN_PLAYERS}到${WEREWOLF_MAX_PLAYERS}名玩家才能开始`,
        );
      }
      if (participants.some(player => !this.dependencies.isPlayerConnected(player.id))) {
        throw new GameRuleError("所有玩家在线后才能开始");
      }

      const gameConfig = envelope.payload.roleDeck
        ? configFromRoleDeck(participants.length, envelope.payload.roleDeck)
        : configFromPlayerCount(participants.length);
      room.gameConfig = gameConfig;
      room.game = werewolfGameModule.createGame(
        {
          playerIds: participants.map(player => player.id),
          config: gameConfig,
        },
        { random: this.environment.random },
      );
      room.updatedAt = this.environment.now();
      return { kind: "broadcast" };
    }

    if (!room.game) throw new GameRuleError("游戏尚未开始");
    const gameConfig = room.gameConfig.playerCount === participants.length
      ? room.gameConfig
      : configFromPlayerCount(participants.length);
    room.gameConfig = gameConfig;
    room.game = werewolfGameModule.createGame(
      {
        playerIds: participants.map(player => player.id),
        config: gameConfig,
      },
      { random: this.environment.random },
    );
    room.updatedAt = this.environment.now();
    return { kind: "broadcast" };
  }
}
