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
      envelope.type !== "botc.nominate" &&
      envelope.type !== "botc.submitDayVote" &&
      envelope.type !== "botc.submitNightChoice" &&
      envelope.type !== "botc.acknowledgeNightInformation";
    if (
      moderatorCommand &&
      !hasGameModeratorControl(snapshot.gameModerator, member)
    ) {
      throw new Error("game command requires moderator authority");
    }

    const mutation: () => BotcRuntimeOutcome = () => {
      const outcome = this.mutate(room, authenticatedPlayerId, envelope);
      this.commitAutomaticInformationIfRequired(room);
      return outcome;
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
    switch (envelope.type) {
      case "botc.startGame":
        return this.startGame(room);
      case "botc.confirmRole":
        return this.confirmRole(room, authenticatedPlayerId);
      case "botc.nominate":
        return this.executePlayerDayCommand(room, authenticatedPlayerId, {
          type: "nominate",
          nomineePlayerId: envelope.payload.nomineePlayerId,
        });
      case "botc.submitDayVote":
        return this.executePlayerDayCommand(room, authenticatedPlayerId, {
          type: "submitDayVote",
          vote: envelope.payload.vote,
        });
      case "botc.submitNightChoice":
        return this.submitNightChoice(
          room,
          authenticatedPlayerId,
          envelope.payload.playerIds,
        );
      case "botc.acknowledgeNightInformation":
        return this.acknowledgeNightInformation(room, authenticatedPlayerId);
      case "botc.beginFirstNight":
        return this.executeModeratorGameCommand(room, {
          type: "beginFirstNight",
        });
      case "botc.beginOtherNight":
        return this.executeModeratorGameCommand(room, {
          type: "beginOtherNight",
        });
      case "botc.closeNomination":
        return this.executeModeratorGameCommand(room, {
          type: "closeNomination",
        });
      case "botc.resolveDay":
        return this.executeModeratorGameCommand(room, {
          type: "resolveDay",
        });
      case "botc.setRedHerring":
        if (room.gameModerator.mode !== "human") {
          throw new Error("Manual Red Herring setup requires Human Storyteller mode");
        }
        return this.executeModeratorGameCommand(room, {
          type: "setRedHerring",
          playerId: envelope.payload.playerId,
        });
      case "botc.commitNightInformation":
        return this.executeModeratorGameCommand(room, {
          type: "commitNightInformation",
        });
      case "botc.completeNightStep":
        return this.executeModeratorGameCommand(room, {
          type: "completeNightStep",
        });
    }
  }

  private confirmRole(
    room: CloudflareBotcRoom,
    playerId: string,
  ): BotcCommandOutcome {
    if (!room.game) throw new Error("BotC game has not started");

    const now = this.environment.now();
    const result = botcGameModule.handleCommand(
      room.game,
      {
        playerId,
        isModerator: false,
        now,
      },
      { type: "confirmRole" },
      { random: this.environment.random },
    );
    if (!result.outcome) {
      throw new Error("BotC confirmRole produced no outcome");
    }
    room.game = result.state;
    room.updatedAt = now;
    return result.outcome;
  }

  private executePlayerDayCommand(
    room: CloudflareBotcRoom,
    playerId: string,
    command:
      | { type: "nominate"; nomineePlayerId: string }
      | { type: "submitDayVote"; vote: boolean },
  ): BotcCommandOutcome {
    if (!room.game) throw new Error("BotC game has not started");

    const now = this.environment.now();
    const result = botcGameModule.handleCommand(
      room.game,
      {
        playerId,
        isModerator: false,
        now,
      },
      command,
      { random: this.environment.random },
    );
    if (!result.outcome) {
      throw new Error(`BotC ${command.type} produced no outcome`);
    }
    room.game = result.state;
    room.updatedAt = now;
    return result.outcome;
  }

  private submitNightChoice(
    room: CloudflareBotcRoom,
    playerId: string,
    playerIds: string[],
  ): BotcCommandOutcome {
    if (!room.game) throw new Error("BotC game has not started");

    const now = this.environment.now();
    const result = botcGameModule.handleCommand(
      room.game,
      {
        playerId,
        isModerator: false,
        now,
      },
      {
        type: "submitNightChoice",
        playerIds,
      },
      { random: this.environment.random },
    );
    if (!result.outcome) {
      throw new Error("BotC submitNightChoice produced no outcome");
    }
    room.game = result.state;
    room.updatedAt = now;
    return result.outcome;
  }

  private commitAutomaticInformationIfRequired(
    room: CloudflareBotcRoom,
  ): void {
    if (room.gameModerator.mode !== "automatic" || !room.game) return;

    const context = {
      players: gameParticipantPlayers(room).map(({ id, name, seat }) => ({
        id,
        name,
        seat,
      })),
    };
    const moderatorView = botcGameModule.getModeratorView(room.game, context);
    if (
      !moderatorView.informationDecision ||
      moderatorView.informationDecision.committed
    ) {
      return;
    }

    const now = this.environment.now();
    const result = botcGameModule.handleCommand(
      room.game,
      {
        isModerator: true,
        now,
      },
      { type: "commitNightInformation" },
      { random: this.environment.random },
    );
    if (!result.outcome || result.outcome.kind !== "nightInformationCommitted") {
      throw new Error("Automatic BotC information commit produced no commit outcome");
    }
    room.game = result.state;
    room.updatedAt = now;
  }

  private acknowledgeNightInformation(
    room: CloudflareBotcRoom,
    playerId: string,
  ): BotcCommandOutcome {
    if (!room.game) throw new Error("BotC game has not started");

    const now = this.environment.now();
    const result = botcGameModule.handleCommand(
      room.game,
      {
        playerId,
        isModerator: false,
        now,
      },
      { type: "acknowledgeNightInformation" },
      { random: this.environment.random },
    );
    if (!result.outcome) {
      throw new Error("BotC acknowledgeNightInformation produced no outcome");
    }
    room.game = result.state;
    room.updatedAt = now;
    return result.outcome;
  }

  private executeModeratorGameCommand(
    room: CloudflareBotcRoom,
    command:
      | { type: "beginFirstNight" }
      | { type: "beginOtherNight" }
      | { type: "closeNomination" }
      | { type: "resolveDay" }
      | { type: "setRedHerring"; playerId: string }
      | { type: "commitNightInformation" }
      | { type: "completeNightStep" },
  ): BotcCommandOutcome {
    if (!room.game) throw new Error("BotC game has not started");

    const now = this.environment.now();
    const result = botcGameModule.handleCommand(
      room.game,
      {
        isModerator: true,
        now,
      },
      command,
      { random: this.environment.random },
    );
    if (!result.outcome) {
      throw new Error(`BotC ${command.type} produced no outcome`);
    }
    room.game = result.state;
    room.updatedAt = now;
    return result.outcome;
  }
}
