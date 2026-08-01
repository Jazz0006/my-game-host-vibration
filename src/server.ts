import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import {
  GameRuleError,
  type GameState,
} from "./domain/game.js";
import {
  createGameEngineRegistry,
  GameRegistryError,
  type GameEngineRegistry,
} from "./games/registry.js";
import { DouDizhuRuleError } from "./games/doudizhu/errors.js";
import type { GameTransition } from "./games/shared/engine.js";
import type { GameKind } from "./games/shared/metadata.js";
import type { WerewolfCommand } from "./games/werewolf/engine.js";
import {
  acknowledgePrompt,
  createTestPrompt,
  submitPrompt,
  type TestPrompt,
} from "./domain/testPrompt.js";
import { createSessionToken, verifySessionToken } from "./domain/sessionToken.js";
import {
  ROOM_SNAPSHOT_SCHEMA_VERSION,
  SqliteRoomStore,
  type PersistedRoom,
  type RoomStore,
} from "./infrastructure/roomStore.js";

export type Player = {
  id: string;
  name: string;
  seat: number;
  socketId: string | null;
  connected: boolean;
  isHost: boolean;
  resumeTokenHash: string;
};

export type Room = {
  id: string;
  gameKind: GameKind;
  players: Player[];
  createdAt: number;
  updatedAt: number;
  config: unknown;
  engineRegistry: GameEngineRegistry;
  roomStore?: RoomStore;
  activePrompt?: TestPrompt;
  game?: { kind: GameKind; state: unknown };
};

type ClientAck<T> = (response: T) => void;
type BasicAck = ClientAck<{ ok: true } | { ok: false; message: string }>;
type GameCommandAck = ClientAck<
  | { ok: true; changed: boolean; revision?: number | undefined; actionId?: string | undefined }
  | { ok: false; message: string }
>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devDirectory = path.join(__dirname, "../dev");
const GAME_REGISTRY = createGameEngineRegistry();

function createRoomId(rooms: Map<string, Room>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomId = String(crypto.randomInt(100000, 1000000));
    if (!rooms.has(roomId)) return roomId;
  }
  throw new Error("暂时无法创建房间号");
}

function findMembership(rooms: Map<string, Room>, socketId: string) {
  for (const room of rooms.values()) {
    const player = room.players.find(item => item.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}

function persistedRoom(room: Room): PersistedRoom {
  return {
    schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION,
    id: room.id,
    gameKind: room.gameKind,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      isHost: player.isHost,
      resumeTokenHash: player.resumeTokenHash,
    })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    config: room.config,
    ...(room.activePrompt ? { activePrompt: room.activePrompt } : {}),
    ...(room.game ? { game: room.game } : {}),
  };
}

function persistRoom(room: Room): void {
  if (!room.roomStore) return;
  room.updatedAt = Date.now();
  room.roomStore.saveRoom(persistedRoom(room));
}

function appendRoomEvent(
  room: Room,
  eventType: string,
  options: { actorPlayerId?: string; payload?: unknown } = {},
): void {
  room.roomStore?.appendEvent({
    roomId: room.id,
    eventType,
    ...(options.actorPlayerId ? { actorPlayerId: options.actorPlayerId } : {}),
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

function publicPlayer(player: Player) {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    isHost: player.isHost,
  };
}

const MAX_ROOM_PLAYERS = Math.max(
  ...GAME_REGISTRY.listMetadata().map(metadata => metadata.maxPlayers),
);
const PLAYER_NUMBER_LABELS = [
  "一", "二", "三", "四", "五", "六",
  "七", "八", "九", "十", "十一", "十二",
];

function playerNameExists(room: Room, name: string, exceptPlayerId?: string): boolean {
  const normalized = name.toLocaleLowerCase();
  return room.players.some(player =>
    player.id !== exceptPlayerId && player.name.toLocaleLowerCase() === normalized
  );
}

function nextDefaultPlayerName(room?: Room): string {
  for (let index = 0; index < MAX_ROOM_PLAYERS; index += 1) {
    const number = PLAYER_NUMBER_LABELS[index] ?? String(index + 1);
    const candidate = `新玩家${number}号`;
    if (!room || !playerNameExists(room, candidate)) return candidate;
  }
  return `新玩家${Date.now().toString().slice(-4)}号`;
}

function requestedPlayerName(room: Room | undefined, value?: string): string {
  const requested = value?.trim().slice(0, 20);
  if (!requested) return nextDefaultPlayerName(room);
  if (room && playerNameExists(room, requested)) return nextDefaultPlayerName(room);
  return requested;
}

function normalizeSeats(room: Room): void {
  room.players.forEach((player, index) => {
    player.seat = index + 1;
  });
}

function removePlayer(room: Room, playerId: string): Player | undefined {
  const index = room.players.findIndex(player => player.id === playerId);
  if (index < 0) return undefined;
  const [removed] = room.players.splice(index, 1);
  normalizeSeats(room);
  if (room.activePrompt?.targetPlayerId === playerId) delete room.activePrompt;
  return removed;
}

function activeWerewolfGame(room: Room): GameState | undefined {
  return room.game?.kind === "werewolf" ? room.game.state as GameState : undefined;
}

function handleWerewolfCommand(
  room: Room,
  command: WerewolfCommand,
): GameTransition<GameState> {
  const game = activeWerewolfGame(room);
  if (!game) throw new GameRuleError("当前房间不支持狼人杀命令");
  const transition = room.engineRegistry.handleCommand(
    room.gameKind,
    game,
    command,
  ) as GameTransition<GameState>;
  room.game = { kind: room.gameKind, state: transition.state };
  if (transition.changed) {
    appendRoomEvent(room, `werewolf:${command.type}`, {
      ...("playerId" in command ? { actorPlayerId: command.playerId } : {}),
    });
  }
  return transition;
}

type LegacyPublicGameView = {
  phase: string;
  confirmedRoles: number;
  completedNightSteps: number;
  dayNumber: number;
  nightNumber: number;
  aliveCount: number;
  votesRequired: number;
  votesCast: number;
  voteTally?: Record<string, number>;
  pkCandidateIds: string[];
  eliminatedTodayId?: string;
  noKillToday: boolean;
  winner?: string;
  deadPlayerIds: string[];
};

type LegacyLobbyView = {
  defaultRoleDeck: unknown;
  roleCatalog: unknown;
};

function roomView(room: Room, viewer: Player) {
  const prompt = room.activePrompt;
  const game = room.game;
  const metadata = room.engineRegistry.getMetadata(room.gameKind);
  const gameView = game
    ? room.engineRegistry.projectPublicView(
        room.gameKind,
        game.state,
        { players: room.players, viewerIsHost: viewer.isHost },
      ) as LegacyPublicGameView
    : undefined;
  const lobbyView = !game
    ? room.engineRegistry.projectLobbyView(
        room.gameKind,
        room.players.length,
        room.config,
      ) as LegacyLobbyView
    : undefined;
  return {
    roomId: room.id,
    gameKind: room.gameKind,
    viewer: { playerId: viewer.id, isHost: viewer.isHost },
    players: room.players.map(publicPlayer),
    defaultRoleDeck: lobbyView?.defaultRoleDeck,
    roleCatalog: lobbyView?.roleCatalog,
    game: {
      phase: gameView?.phase ?? "lobby",
      canStart:
        !game &&
        room.players.length >= metadata.minPlayers &&
        room.players.length <= metadata.maxPlayers &&
        room.players.every(player => player.connected),
      minPlayers: metadata.minPlayers,
      maxPlayers: metadata.maxPlayers,
      confirmedRoles: gameView?.confirmedRoles ?? 0,
      completedNightSteps: gameView?.completedNightSteps ?? 0,
      dayNumber: gameView?.dayNumber ?? 0,
      nightNumber: gameView?.nightNumber ?? 0,
      aliveCount: gameView?.aliveCount ?? 0,
      votesRequired: gameView?.votesRequired ?? 0,
      votesCast: gameView?.votesCast ?? 0,
      voteTally: gameView?.voteTally,
      pkCandidateIds: gameView?.pkCandidateIds ?? [],
      eliminatedTodayId: gameView?.eliminatedTodayId,
      noKillToday: gameView?.noKillToday ?? false,
      winner: gameView?.winner,
      deadPlayerIds: gameView?.deadPlayerIds ?? [],
    },
    testPrompt:
      viewer.isHost && prompt
        ? {
            id: prompt.id,
            targetPlayerId: prompt.targetPlayerId,
            status: prompt.status,
            choice: prompt.status === "submitted" ? prompt.choice : undefined,
          }
        : undefined,
  };
}

function sendPrivateState(io: Server, room: Room, player: Player): void {
  if (!player.socketId) return;
  const view = room.game
    ? room.engineRegistry.projectPlayerView(room.gameKind, room.game.state, player.id, {
        players: room.players,
        viewerIsHost: player.isHost,
      })
    : { phase: "lobby", mode: "lobby" };
  io.to(player.socketId).emit("player:game-state", view);
}

function sendCurrentTestPrompt(socket: Socket, room: Room, player: Player): void {
  const prompt = room.activePrompt;
  if (!prompt || prompt.targetPlayerId !== player.id) return;
  socket.emit("player:test-prompt-state", {
    promptId: prompt.id,
    status: prompt.status,
    choice: prompt.status === "submitted" ? prompt.choice : undefined,
  });
  if (prompt.status === "sent") {
    socket.emit("player:test-prompt", { promptId: prompt.id, resumed: true });
  }
}

function broadcastRoom(io: Server, room: Room): void {
  persistRoom(room);
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("room:state", roomView(room, player));
    sendPrivateState(io, room, player);
  }
}

function alertCurrentActors(io: Server, room: Room, resumed = false): void {
  if (!room.game) return;
  const gameView = room.engineRegistry.projectPublicView(
    room.gameKind,
    room.game.state,
    { players: room.players, viewerIsHost: false },
  ) as { actionId?: string; phase?: string };
  for (const playerId of room.engineRegistry.actingPlayerIds(room.gameKind, room.game.state)) {
    const player = room.players.find(item => item.id === playerId);
    if (player?.socketId) {
      io.to(player.socketId).emit("player:action-alert", {
        actionId: gameView.actionId,
        phase: gameView.phase,
        resumed,
      });
    }
  }
}

function afterNightAction(io: Server, room: Room): void {
  const game = activeWerewolfGame(room);
  if (!game) return;

  if (game.phase === "game_over") {
    broadcastRoom(io, room);
    io.to(room.id).emit("game:over", { winner: game.winner });
    return;
  }
  if (game.phase === "night_complete") {
    io.to(room.id).emit("game:night-complete", { actionId: game.actionId });
    handleWerewolfCommand(room, { type: "start_day_vote" });
    broadcastRoom(io, room);
    alertCurrentActors(io, room);
    return;
  }
  if (game.phase === "day_hunter" && game.hunterTrigger === "night") {
    io.to(room.id).emit("game:night-complete", { actionId: game.actionId });
    broadcastRoom(io, room);
    alertCurrentActors(io, room);
    return;
  }

  broadcastRoom(io, room);
  alertCurrentActors(io, room);
}

function afterCloseDayVote(io: Server, room: Room): void {
  const game = activeWerewolfGame(room);
  if (!game) return;
  const { phase } = game;
  if (phase === "game_over") {
    io.to(room.id).emit("game:over", { winner: game.winner });
  } else if (phase === "day_hunter") {
    alertCurrentActors(io, room);
  } else if (phase === "day_pk") {
    alertCurrentActors(io, room); // alert eligible non-PK voters
  }
  // "no_kill" and "day_result" just need the broadcast already done
}

function ruleError(ack: BasicAck, error: unknown): void {
  ack({
    ok: false,
    message:
      error instanceof GameRuleError ||
      error instanceof DouDizhuRuleError ||
      error instanceof GameRegistryError
        ? error.message
        : "操作失败，请重试",
  });
}

export function createGameServer(options: {
  gameRegistry?: GameEngineRegistry;
  roomStore?: RoomStore;
  idleRoomTtlMs?: number;
} = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map<string, Room>();
  const gameRegistry = options.gameRegistry ?? GAME_REGISTRY;
  const roomStore = options.roomStore;

  if (roomStore) {
    const idleRoomTtlMs = options.idleRoomTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    roomStore.deleteRoomsUpdatedBefore(Date.now() - idleRoomTtlMs);
    for (const snapshot of roomStore.loadRooms()) {
      try {
        gameRegistry.getEngine(snapshot.gameKind);
        const room: Room = {
          id: snapshot.id,
          gameKind: snapshot.gameKind,
          players: snapshot.players.map(player => ({
            ...player,
            socketId: null,
            connected: false,
          })),
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          config: snapshot.config,
          engineRegistry: gameRegistry,
          roomStore,
          ...(snapshot.activePrompt ? { activePrompt: snapshot.activePrompt as TestPrompt } : {}),
          ...(snapshot.game ? { game: snapshot.game } : {}),
        };
        rooms.set(room.id, room);
      } catch {
        // Keep incompatible snapshots in SQLite for a future compatible rules engine.
      }
    }
  }

  app.use(express.static(path.join(__dirname, "../public")));
  if (process.env.NODE_ENV !== "production") {
    app.use("/dev/assets", express.static(devDirectory, { etag: false, maxAge: 0 }));
    app.get("/dev/lab", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(devDirectory, "lab.html"));
    });
  }
  app.get("/health", (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, time: new Date().toISOString() });
  });
  app.get("/api/games", (_req, res) => {
    res.json({ games: gameRegistry.listMetadata() });
  });

  io.on("connection", (socket: Socket) => {
    socket.on(
      "host:create-room",
      (data: { name?: string; gameKind?: unknown } | undefined, ack: ClientAck<unknown>) => {
      try {
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        const roomId = createRoomId(rooms);
        const requestedGameKind = data?.gameKind ?? "werewolf";
        const metadata = gameRegistry.requireAvailable(requestedGameKind);
        const { kind: gameKind } = metadata;
        const config = gameRegistry.createConfig(gameKind, metadata.minPlayers);
        const session = createSessionToken();
        const host: Player = {
          id: crypto.randomUUID(),
          name: requestedPlayerName(undefined, data?.name),
          seat: 1,
          socketId: socket.id,
          connected: true,
          isHost: true,
          resumeTokenHash: session.hash,
        };
        const room: Room = {
          id: roomId,
          gameKind,
          players: [host],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          config,
          engineRegistry: gameRegistry,
          ...(roomStore ? { roomStore } : {}),
        };
        rooms.set(roomId, room);
        appendRoomEvent(room, "room_created", { actorPlayerId: host.id });
        void socket.join(roomId);
        ack({
          ok: true,
          roomId,
          playerId: host.id,
          seat: host.seat,
          name: host.name,
          resumeToken: session.token,
          gameKind: room.gameKind,
        });
        broadcastRoom(io, room);
      } catch (error) {
        ack({
          ok: false,
          message: error instanceof GameRegistryError ? error.message : "创建房间失败",
        });
      }
      },
    );

    socket.on(
      "player:join-room",
      (data: { roomId?: string; name?: string }, ack: ClientAck<unknown>) => {
        const roomId = data.roomId?.trim();
        const room = roomId ? rooms.get(roomId) : undefined;
        if (!roomId) return ack({ ok: false, message: "请输入房间号" });
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        if (!room) return ack({ ok: false, message: "房间不存在" });
        if (room.game) return ack({ ok: false, message: "游戏已经开始，不能再加入" });
        const metadata = room.engineRegistry.getMetadata(room.gameKind);
        if (room.players.length >= metadata.maxPlayers) {
          return ack({ ok: false, message: `房间最多${metadata.maxPlayers}人` });
        }

        const name = requestedPlayerName(room, data.name);
        const session = createSessionToken();
        const player: Player = {
          id: crypto.randomUUID(),
          name,
          seat: room.players.length + 1,
          socketId: socket.id,
          connected: true,
          isHost: false,
          resumeTokenHash: session.hash,
        };
        room.players.push(player);
        void socket.join(roomId);
        appendRoomEvent(room, "player_joined", { actorPlayerId: player.id });
        ack({
          ok: true,
          roomId,
          playerId: player.id,
          seat: player.seat,
          name: player.name,
          resumeToken: session.token,
          gameKind: room.gameKind,
        });
        broadcastRoom(io, room);
      },
    );

    socket.on(
      "player:resume",
      (
        data: { roomId?: string; playerId?: string; resumeToken?: string },
        ack: ClientAck<unknown>,
      ) => {
        const roomId = data.roomId?.trim();
        const playerId = data.playerId?.trim();
        const resumeToken = data.resumeToken?.trim();
        if (!roomId || !playerId || !resumeToken) {
          return ack({ ok: false, message: "恢复凭证无效" });
        }
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }

        const room = rooms.get(roomId);
        const player = room?.players.find(item => item.id === playerId);
        if (!room || !player || !verifySessionToken(resumeToken, player.resumeTokenHash)) {
          return ack({ ok: false, message: "恢复凭证无效" });
        }

        const previousSocketId = player.socketId;
        player.socketId = socket.id;
        player.connected = true;
        void socket.join(room.id);
        appendRoomEvent(room, "player_resumed", { actorPlayerId: player.id });

        if (previousSocketId && previousSocketId !== socket.id) {
          const previousSocket = io.sockets.sockets.get(previousSocketId);
          previousSocket?.emit("session:replaced", { roomId: room.id, playerId: player.id });
          previousSocket?.disconnect(true);
        }

        ack({
          ok: true,
          roomId: room.id,
          playerId: player.id,
          seat: player.seat,
          name: player.name,
          isHost: player.isHost,
          gameKind: room.gameKind,
        });
        broadcastRoom(io, room);
        sendCurrentTestPrompt(socket, room, player);
        if (
          room.game &&
          room.engineRegistry.actingPlayerIds(room.gameKind, room.game.state).includes(player.id)
        ) {
          alertCurrentActors(io, room, true);
        }
      },
    );

    socket.on("host:start-game", (data: { roleDeck?: string[] } | undefined, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以开始游戏" });
      const { room } = membership;
      if (room.game) return ack({ ok: false, message: "游戏已经开始" });
      const metadata = room.engineRegistry.getMetadata(room.gameKind);
      if (
        room.players.length < metadata.minPlayers ||
        room.players.length > metadata.maxPlayers
      ) {
        return ack({
          ok: false,
          message: `需要${metadata.minPlayers}到${metadata.maxPlayers}名玩家才能开始`,
        });
      }
      if (room.players.some(player => !player.connected)) {
        return ack({ ok: false, message: "所有玩家在线后才能开始" });
      }

      try {
        const gameConfig = room.engineRegistry.createConfig(
          room.gameKind,
          room.players.length,
          data,
        );
        room.config = gameConfig;
        room.game = {
          kind: room.gameKind,
          state: room.engineRegistry.createInitialState(room.gameKind, {
            playerIds: room.players.map(player => player.id),
            config: gameConfig,
          }),
        };
        delete room.activePrompt;
        appendRoomEvent(room, "game_started", {
          actorPlayerId: membership.player.id,
          payload: { gameKind: room.gameKind },
        });
        broadcastRoom(io, room);
        alertCurrentActors(io, room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on(
      "game:command",
      (data: Record<string, unknown> | undefined, ack: GameCommandAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
        const { room, player } = membership;
        if (!room.game) return ack({ ok: false, message: "游戏尚未开始" });
        if (room.gameKind === "werewolf") {
          return ack({ ok: false, message: "狼人杀仍使用现有命令协议" });
        }
        if (!data || typeof data.type !== "string") {
          return ack({ ok: false, message: "游戏命令无效" });
        }

        try {
          const transition = room.engineRegistry.handleCommand(
            room.gameKind,
            room.game.state,
            { ...data, actorPlayerId: player.id },
          );
          room.game = { kind: room.gameKind, state: transition.state };
          if (transition.changed) {
            appendRoomEvent(room, `command:${String(data.type)}`, {
              actorPlayerId: player.id,
            });
            for (const event of transition.events) {
              appendRoomEvent(room, event.type, {
                actorPlayerId: player.id,
                ...(event.payload === undefined ? {} : { payload: event.payload }),
              });
            }
            broadcastRoom(io, room);
            for (const event of transition.events) {
              io.to(room.id).emit("game:event", event);
            }
            alertCurrentActors(io, room);
          }
          const publicView = room.engineRegistry.projectPublicView(
            room.gameKind,
            room.game.state,
            { players: room.players, viewerIsHost: false },
          ) as { revision?: number; actionId?: string };
          ack({
            ok: true,
            changed: transition.changed,
            revision: publicView.revision,
            actionId: publicView.actionId,
          });
        } catch (error) {
          ack({
            ok: false,
            message:
              error instanceof DouDizhuRuleError || error instanceof GameRegistryError
                ? error.message
                : "操作失败，请重试",
          });
        }
      },
    );

    socket.on(
      "host:move-player-seat",
      (data: { targetPlayerId?: string; insertIndex?: number }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以调整座位" });
        if (membership.room.game) return ack({ ok: false, message: "游戏开始后不能调整座位" });
        const { room } = membership;
        const originalIndex = room.players.findIndex(player => player.id === data.targetPlayerId);
        if (originalIndex < 0) return ack({ ok: false, message: "玩家不存在" });
        if (
          !Number.isInteger(data.insertIndex) ||
          data.insertIndex! < 0 ||
          data.insertIndex! > room.players.length
        ) return ack({ ok: false, message: "目标座位无效" });

        const target = room.players[originalIndex]!;
        room.players.splice(originalIndex, 1);
        const adjustedIndex = data.insertIndex! > originalIndex
          ? data.insertIndex! - 1
          : data.insertIndex!;
        room.players.splice(adjustedIndex, 0, target);
        normalizeSeats(room);
        broadcastRoom(io, room);
        ack({ ok: true });
      },
    );

    socket.on(
      "player:update-name",
      (
        data: { name?: string },
        ack: ClientAck<{ ok: true; name: string } | { ok: false; message: string }>,
      ) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
        const name = data.name?.trim();
        if (!name) return ack({ ok: false, message: "名字不能为空" });
        if (name.length > 20) return ack({ ok: false, message: "名字最多20个字符" });
        if (playerNameExists(membership.room, name, membership.player.id)) {
          return ack({ ok: false, message: "这个名字已被房间里的其他玩家使用" });
        }
        membership.player.name = name;
        broadcastRoom(io, membership.room);
        ack({ ok: true, name });
      },
    );

    socket.on(
      "host:remove-player",
      (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以移除玩家" });
        }
        if (membership.room.game) {
          return ack({ ok: false, message: "游戏开始后不能移除玩家" });
        }
        const target = membership.room.players.find(player => player.id === data.targetPlayerId);
        if (!target || target.isHost) {
          return ack({ ok: false, message: "请选择一名其他玩家" });
        }

        const targetSocket = target.socketId ? io.sockets.sockets.get(target.socketId) : undefined;
        removePlayer(membership.room, target.id);
        targetSocket?.emit("room:removed", { roomId: membership.room.id, reason: "removed" });
        if (process.env.NODE_ENV !== "production") {
          io.emit("dev:player-removed", {
            roomId: membership.room.id,
            playerId: target.id,
          });
        }
        if (targetSocket) void targetSocket.leave(membership.room.id);
        broadcastRoom(io, membership.room);
        ack({ ok: true });
      },
    );

    socket.on(
      "host:transfer-host",
      (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以转让房主" });
        }
        const target = membership.room.players.find(player => player.id === data.targetPlayerId);
        if (!target || target.id === membership.player.id) {
          return ack({ ok: false, message: "请选择一名其他玩家" });
        }
        if (!target.connected || !target.socketId) {
          return ack({ ok: false, message: "只能将房主转让给在线玩家" });
        }

        membership.player.isHost = false;
        target.isHost = true;
        broadcastRoom(io, membership.room);
        ack({ ok: true });
      },
    );

    socket.on(
      "host:leave-and-transfer",
      (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以转让后退出" });
        }
        if (membership.room.game) {
          return ack({ ok: false, message: "游戏开始后不能单独退出；如需中断游戏，请关闭房间" });
        }
        const target = membership.room.players.find(player => player.id === data.targetPlayerId);
        if (!target || target.id === membership.player.id) {
          return ack({ ok: false, message: "请选择一名其他玩家" });
        }
        if (!target.connected || !target.socketId) {
          return ack({ ok: false, message: "只能将房主转让给在线玩家" });
        }

        membership.player.isHost = false;
        target.isHost = true;
        removePlayer(membership.room, membership.player.id);
        void socket.leave(membership.room.id);
        broadcastRoom(io, membership.room);
        ack({ ok: true });
      },
    );

    socket.on("host:close-room", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) {
        return ack({ ok: false, message: "只有房主可以关闭房间" });
      }
      const roomId = membership.room.id;
      rooms.delete(roomId);
      membership.room.roomStore?.deleteRoom(roomId);
      io.to(roomId).emit("room:closed", { roomId, reason: "host_closed" });
      io.in(roomId).socketsLeave(roomId);
      ack({ ok: true });
    });

    socket.on("player:leave-room", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
      if (membership.room.game) {
        return ack({ ok: false, message: "游戏开始后不能退出房间" });
      }
      if (membership.player.isHost && membership.room.players.length > 1) {
        return ack({ ok: false, message: "请先指定新的房主，再退出房间" });
      }

      removePlayer(membership.room, membership.player.id);
      void socket.leave(membership.room.id);
      if (membership.room.players.length === 0) {
        rooms.delete(membership.room.id);
        membership.room.roomStore?.deleteRoom(membership.room.id);
      }
      else broadcastRoom(io, membership.room);
      ack({ ok: true });
    });

    socket.on("player:confirm-role", (data: { actionId?: string }, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      const game = membership ? activeWerewolfGame(membership.room) : undefined;
      if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        handleWerewolfCommand(membership.room, {
          type: "confirm_role",
          playerId: membership.player.id,
          actionId: data.actionId,
        });
        broadcastRoom(io, membership.room);
        // All roles confirmed → night_start; host will click to begin the night
        if (game.phase === "night_start") {
          // no actor alert needed yet — host sees 开始夜晚 button
        }
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on(
      "player:submit-wolf-target",
      (data: { actionId?: string; targetPlayerId?: string | null }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        const game = membership ? activeWerewolfGame(membership.room) : undefined;
        if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const { changed: advanced } = handleWerewolfCommand(membership.room, {
            type: "submit_wolf_target",
            playerId: membership.player.id,
            targetPlayerId: data.targetPlayerId,
            actionId: data.actionId,
          });
          if (advanced) {
            afterNightAction(io, membership.room);
          }
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on(
      "player:submit-witch-action",
      (
        data: { actionId?: string; useAntidote?: boolean; poisonTargetId?: string | null },
        ack: BasicAck,
      ) => {
        const membership = findMembership(rooms, socket.id);
        const game = membership ? activeWerewolfGame(membership.room) : undefined;
        if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const action: { useAntidote?: boolean; poisonTargetId?: string | null } = {};
          if (data.useAntidote !== undefined) action.useAntidote = data.useAntidote;
          if (data.poisonTargetId !== undefined) action.poisonTargetId = data.poisonTargetId;
          const { changed: advanced } = handleWerewolfCommand(membership.room, {
            type: "submit_witch_action",
            playerId: membership.player.id,
            action,
            actionId: data.actionId,
          });
          if (advanced) {
            afterNightAction(io, membership.room);
          }
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on(
      "player:submit-seer-target",
      (data: { actionId?: string; targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        const game = membership ? activeWerewolfGame(membership.room) : undefined;
        if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          handleWerewolfCommand(membership.room, {
            type: "submit_seer_target",
            playerId: membership.player.id,
            targetPlayerId: data.targetPlayerId,
            actionId: data.actionId,
          });
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on("player:confirm-seer-result", (data: { actionId?: string }, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      const game = membership ? activeWerewolfGame(membership.room) : undefined;
      if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        const { changed: advanced } = handleWerewolfCommand(membership.room, {
          type: "confirm_seer_result",
          playerId: membership.player.id,
          actionId: data.actionId,
        });
        if (advanced) {
          afterNightAction(io, membership.room);
        }
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on(
      "player:submit-guard-target",
      (data: { actionId?: string; targetPlayerId?: string | null }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        const game = membership ? activeWerewolfGame(membership.room) : undefined;
        if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const { changed: advanced } = handleWerewolfCommand(membership.room, {
            type: "submit_guard_target",
            playerId: membership.player.id,
            targetPlayerId: data.targetPlayerId,
            actionId: data.actionId,
          });
          if (advanced) {
            afterNightAction(io, membership.room);
          }
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on(
      "player:submit-hunter-execution",
      (data: { actionId?: string; targetPlayerId?: string | null }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        const game = membership ? activeWerewolfGame(membership.room) : undefined;
        if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const { changed: advanced } = handleWerewolfCommand(membership.room, {
            type: "submit_hunter_execution",
            playerId: membership.player.id,
            targetPlayerId: data.targetPlayerId,
            actionId: data.actionId,
          });
          if (advanced) {
            if (game.phase === "game_over") {
              broadcastRoom(io, membership.room);
              io.to(membership.room.id).emit("game:over", { winner: game.winner });
            } else if (game.phase === "night_complete") {
              // The night death was already announced before the hunter acted.
              handleWerewolfCommand(membership.room, { type: "start_day_vote" });
              broadcastRoom(io, membership.room);
              alertCurrentActors(io, membership.room);
            } else {
              // day_result or day_hunter resolved → just broadcast
              broadcastRoom(io, membership.room);
            }
          }
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on("host:start-night", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以开始夜晚" });
      const game = activeWerewolfGame(membership.room);
      if (!game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        handleWerewolfCommand(membership.room, { type: "start_night" });
        afterNightAction(io, membership.room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on(
      "player:submit-vote",
      (data: { actionId?: string; targetId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        const game = membership ? activeWerewolfGame(membership.room) : undefined;
        if (!membership || !game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const { changed } = handleWerewolfCommand(membership.room, {
            type: "submit_vote",
            playerId: membership.player.id,
            targetId: data.targetId ?? "",
            actionId: data.actionId ?? "",
          });
          if (changed) {
            broadcastRoom(io, membership.room);
            // Auto-close when all alive players have voted
            const publicView = membership.room.engineRegistry.projectPublicView(
              membership.room.gameKind,
              membership.room.game!.state,
              { players: membership.room.players, viewerIsHost: false },
            ) as LegacyPublicGameView;
            if (publicView.votesCast >= publicView.votesRequired) {
              handleWerewolfCommand(membership.room, { type: "close_day_vote" });
              broadcastRoom(io, membership.room);
              afterCloseDayVote(io, membership.room);
            }
          }
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on("host:close-voting", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以关闭投票" });
      const game = activeWerewolfGame(membership.room);
      if (!game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        handleWerewolfCommand(membership.room, { type: "close_day_vote" });
        broadcastRoom(io, membership.room);
        afterCloseDayVote(io, membership.room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on("host:begin-night-start", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以操作" });
      const game = activeWerewolfGame(membership.room);
      if (!game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        handleWerewolfCommand(membership.room, { type: "begin_night_start" });
        broadcastRoom(io, membership.room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on("host:restart-game", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以重新开始游戏" });
      if (!membership.room.game) {
        return ack({ ok: false, message: "游戏尚未开始" });
      }
      const { room } = membership;
      const gameConfig = room.engineRegistry.createConfig(
        room.gameKind,
        room.players.length,
        room.config,
      );
      room.config = gameConfig;
      room.game = {
        kind: room.gameKind,
        state: room.engineRegistry.createInitialState(room.gameKind, {
          playerIds: room.players.map(player => player.id),
          config: gameConfig,
        }),
      };
      delete room.activePrompt;
      appendRoomEvent(room, "game_restarted", { actorPlayerId: membership.player.id });
      broadcastRoom(io, room);
      alertCurrentActors(io, room);
      ack({ ok: true });
    });

    // 开发阶段保留的定向震动闭环，正式游戏开始后自动停用。
    socket.on(
      "host:send-test-prompt",
      (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以发送提醒" });
        if (membership.room.game) return ack({ ok: false, message: "游戏中不能发送测试提醒" });
        const target = membership.room.players.find(player => player.id === data.targetPlayerId);
        if (!target || target.isHost) return ack({ ok: false, message: "请选择一名在线玩家" });
        if (!target.connected || !target.socketId) return ack({ ok: false, message: "该玩家当前离线" });

        const prompt = createTestPrompt(target.id);
        membership.room.activePrompt = prompt;
        io.to(target.socketId).emit("player:test-prompt", { promptId: prompt.id });
        broadcastRoom(io, membership.room);
        ack({ ok: true });
      },
    );

    socket.on("player:ack-test-prompt", (data: { promptId?: string }, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      const prompt = membership?.room.activePrompt;
      if (
        !membership ||
        !prompt ||
        prompt.id !== data.promptId ||
        prompt.targetPlayerId !== membership.player.id
      ) {
        return ack({ ok: false, message: "提醒已失效" });
      }
      membership.room.activePrompt = acknowledgePrompt(prompt);
      broadcastRoom(io, membership.room);
      ack({ ok: true });
    });

    socket.on(
      "player:submit-test-choice",
      (data: { promptId?: string; choice?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        const prompt = membership?.room.activePrompt;
        if (
          !membership ||
          !prompt ||
          prompt.id !== data.promptId ||
          prompt.targetPlayerId !== membership.player.id
        ) {
          return ack({ ok: false, message: "提醒已失效" });
        }
        if (!data.choice?.trim()) return ack({ ok: false, message: "请选择一个有效选项" });
        try {
          membership.room.activePrompt = submitPrompt(prompt, data.choice);
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch {
          ack({ ok: false, message: "请先确认收到提醒" });
        }
      },
    );

    socket.on("disconnect", () => {
      const membership = findMembership(rooms, socket.id);
      if (!membership) return;
      membership.player.connected = false;
      membership.player.socketId = null;
      appendRoomEvent(membership.room, "player_disconnected", {
        actorPlayerId: membership.player.id,
      });
      broadcastRoom(io, membership.room);
    });
  });

  return { app, httpServer, io, rooms };
}

const port = Number(process.env.PORT ?? 3000);
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntryPoint) {
  const databasePath = process.env.ROOM_DB_PATH ?? path.join(__dirname, "../data/gamehost.sqlite");
  const roomStore = new SqliteRoomStore(databasePath);
  const { httpServer } = createGameServer({ roomStore });
  httpServer.once("close", () => roomStore.close());
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`服务运行于 http://localhost:${port}`);
  });
}
