import { RoomCore } from "../../core/room/RoomCore.js";
import {
  createRoomSnapshot,
  nextRoomRevision,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { SessionTokenService } from "../../core/session/SessionTokenService.js";
import { requestedRoomPlayerName } from "./roomPlayerNaming.js";

export type RoomBootstrapSession = {
  roomId: string;
  gameType: string;
  playerId: string;
  resumeToken: string;
  name: string;
  seat: number;
  isHost: boolean;
  revision: number;
};

export class RoomBootstrapError extends Error {
  constructor(
    readonly code: "game_started" | "room_full",
    message: string,
  ) {
    super(message);
    this.name = "RoomBootstrapError";
  }
}

export type RoomBootstrapServiceOptions<TGameConfig> = {
  gameType: string;
  maxPlayers: number;
  createInitialGameConfig(): TGameConfig;
  createPlayerId(): string;
  now?: () => number;
};

export class RoomBootstrapService<TGameState, TGameConfig> {
  private readonly now: () => number;

  constructor(
    private readonly sessionTokens: SessionTokenService,
    private readonly options: RoomBootstrapServiceOptions<TGameConfig>,
  ) {
    this.now = options.now ?? Date.now;
  }

  async create(roomId: string, requestedName?: string): Promise<{
    snapshot: RoomSnapshot<TGameState, TGameConfig>;
    session: RoomBootstrapSession;
  }> {
    const token = await this.sessionTokens.createSessionToken();
    const player: RoomPlayer = {
      id: this.options.createPlayerId(),
      name: requestedRoomPlayerName([], requestedName, this.now),
      seat: 1,
      isHost: true,
      ready: false,
      resumeTokenHash: token.hash,
    };
    const now = this.now();
    const room: RoomState<TGameState, TGameConfig, RoomPlayer> = {
      id: roomId,
      gameType: this.options.gameType,
      players: [player],
      createdAt: now,
      updatedAt: now,
      gameModerator: { mode: "automatic" },
      gameConfig: this.options.createInitialGameConfig(),
    };
    const snapshot = createRoomSnapshot(room, { revision: 0 });
    return {
      snapshot,
      session: {
        roomId,
        gameType: this.options.gameType,
        playerId: player.id,
        resumeToken: token.token,
        name: player.name,
        seat: player.seat,
        isHost: true,
        revision: snapshot.revision,
      },
    };
  }

  async join(
    snapshot: RoomSnapshot<TGameState, TGameConfig, unknown, unknown, unknown>,
    requestedName?: string,
  ): Promise<{
    snapshot: RoomSnapshot<TGameState, TGameConfig, unknown, unknown, unknown>;
    session: RoomBootstrapSession;
  }> {
    if (snapshot.game !== undefined) {
      throw new RoomBootstrapError("game_started", "游戏已经开始，不能再加入");
    }
    if (snapshot.membership.length >= this.options.maxPlayers) {
      throw new RoomBootstrapError("room_full", `房间最多${this.options.maxPlayers}人`);
    }

    const restored = restoreRoomSnapshot(snapshot);
    const token = await this.sessionTokens.createSessionToken();
    const room = restored.room;
    const player = new RoomCore(room, this.now).addPlayer({
      id: this.options.createPlayerId(),
      name: requestedRoomPlayerName(room.players, requestedName, this.now),
      isHost: false,
      ready: false,
      resumeTokenHash: token.hash,
    });
    const revision = nextRoomRevision(snapshot.revision);
    const nextSnapshot = createRoomSnapshot(room, {
      revision,
      ...(snapshot.ruleState === undefined ? {} : { ruleState: snapshot.ruleState }),
      ...(snapshot.pendingInteraction === undefined
        ? {}
        : { pendingInteraction: snapshot.pendingInteraction }),
      ...(snapshot.commandReceipts === undefined
        ? {}
        : { commandReceipts: snapshot.commandReceipts }),
    });

    return {
      snapshot: nextSnapshot,
      session: {
        roomId: room.id,
        gameType: room.gameType,
        playerId: player.id,
        resumeToken: token.token,
        name: player.name,
        seat: player.seat,
        isHost: false,
        revision,
      },
    };
  }
}
