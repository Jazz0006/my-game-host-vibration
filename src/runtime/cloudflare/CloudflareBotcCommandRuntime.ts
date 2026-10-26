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
  type BotcCommandOutcome,
  type BotcCommand,
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

type RoomReceipt = CommandReceipt<BotcRuntimeOutcome>;

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

type BotcRuntimeOutcome = { kind: "gameStarted" } | BotcCommandOutcome;

export type CloudflareBotcCommandExecution = {
  outcome: BotcRuntimeOutcome;
  replayed: boolean;
  revision: number;
  snapshot: BotcSnapshot;
};

export type CloudflareBotcCommandDependencies = {
  isPlayerConnected(playerId: string): boolean;
  environment?: CloudflareBotcCommandEnvironment;
};

const MODERATOR_SCOPE = "game-moderator";

function playerScope(playerId: string): string {
  return `player:${playerId}`;
}

function defaultEnvironment(): CloudflareBotcCommandEnvironment {
  return {
    random: new CloudflareRandomProvider(),
    now: Date.now,
  };
}

export class CloudflareBotcCommandRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository<BotcSnapshot>;
  private readonly commands =
    new RoomCommandRuntime<BotcRuntimeOutcome, CloudflareBotcRoom>();
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

    const moderatorCommand =
      envelope.type !== "botc.confirmRole" &&
      envelope.type !== "botc.submitNightChoice" &&
      envelope.type !== "botc.nominate" && envelope.type !== "botc.vote" &&
      envelope.type !== "botc.acknowledgeNightInformation";
    if (
      moderatorCommand &&
      !hasGameModeratorControl(snapshot.gameModerator, member)
    ) {
      throw new Error("game command requires moderator authority");
    }

    const mutation: () => BotcRuntimeOutcome = () => {
      return this.mutate(room, authenticatedPlayerId, envelope);
    };
    const execution = await this.commands.execute(
      room,
      moderatorCommand ? MODERATOR_SCOPE : playerScope(authenticatedPlayerId),
      envelope.commandId,
      mutation,
      { resetReceiptHistory: envelope.type === "botc.startGame" },
    );

    if (execution.replayed) {
      return {
        outcome: execution.outcome,
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
      outcome: execution.outcome,
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

  private mutate(
    room: CloudflareBotcRoom,
    authenticatedPlayerId: string,
    envelope: BotcClientCommandEnvelope,
  ): BotcRuntimeOutcome {
    if (envelope.type === "botc.startGame") return this.startGame(room);
    if (!room.game) throw new Error("BotC game has not started");
    if (envelope.type === "botc.setRedHerring" && room.gameModerator.mode !== "human") {
      throw new Error("Manual Red Herring setup requires Human Storyteller mode");
    }
    let command: BotcCommand;
    switch (envelope.type) {
      case "botc.beginOtherNight": command = { type: "beginOtherNight" }; break;
      case "botc.nominate": command = { type: "nominate", playerId: envelope.payload.playerId }; break;
      case "botc.vote": command = { type: "vote", approve: envelope.payload.approve }; break;
      case "botc.finishVote": command = { type: "finishVote" }; break;
      case "botc.closeDay": command = { type: "closeDay" }; break;
      case "botc.confirmRole": command = { type: "confirmRole" }; break;
      case "botc.beginFirstNight": command = { type: "beginFirstNight" }; break;
      case "botc.setRedHerring": command = { type: "setRedHerring", playerId: envelope.payload.playerId }; break;
      case "botc.submitNightChoice": command = { type: "submitNightChoice", playerIds: envelope.payload.playerIds }; break;
      case "botc.commitNightInformation": command = { type: "commitNightInformation" }; break;
      case "botc.acknowledgeNightInformation": command = { type: "acknowledgeNightInformation" }; break;
      case "botc.completeNightStep": command = { type: "completeNightStep" }; break;
    }
    const playerCommand = ["confirmRole", "submitNightChoice", "acknowledgeNightInformation", "nominate", "vote"].includes(command.type);
    const now = this.environment.now();
    const result = botcGameModule.handleCommand(room.game, {
      playerId: authenticatedPlayerId, isModerator: !playerCommand, now,
      ...(envelope.payload.actionId === undefined ? {} : { actionId: envelope.payload.actionId }),
      automaticInformation: room.gameModerator.mode === "automatic",
    }, command, { random: this.environment.random });
    if (!result.outcome) throw new Error("BotC game command produced no outcome");
    room.game = result.state;
    room.updatedAt = now;
    return result.outcome;
  }
}
