import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import {
  allAliveVoted,
  beginNightStart,
  closeDayVote,
  configFromRoleDeck,
  configFromPlayerCount,
  confirmRole,
  confirmSeerResult,
  DEFAULT_GAME_CONFIG,
  GameRuleError,
  startDayVote,
  startGame,
  startNight,
  submitGuardTarget,
  submitHunterExecution,
  submitSeerTarget,
  submitVote,
  submitWitchAction,
  submitWolfTarget,
  type GameConfig,
  type GameState,
  type Role,
} from "./domain/game.js";
import {
  acknowledgePrompt,
  createTestPrompt,
  submitPrompt,
  type TestPrompt,
} from "./domain/testPrompt.js";
import { createSessionToken, verifySessionToken } from "./domain/sessionToken.js";

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
  players: Player[];
  createdAt: number;
  config: GameConfig;
  activePrompt?: TestPrompt;
  game?: GameState;
};

type ClientAck<T> = (response: T) => void;
type BasicAck = ClientAck<{ ok: true } | { ok: false; message: string }>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devDirectory = path.join(__dirname, "../dev");

const ROLE_INFO: Record<Role, { name: string; description: string }> = {
  werewolf: { name: "狼人", description: "夜间可以击杀任意一名存活玩家（包括狼人）或选择空刀。" },
  seer: { name: "预言家", description: "每晚可以查验一名其他玩家的阵营。" },
  witch: { name: "女巫", description: "拥有一瓶解药和一瓶毒药，同一晚只能使用一瓶。" },
  guard: { name: "守卫", description: "每晚可以保护一名玩家（包括自己）或空守，但不能连续两晚保护同一人。" },
  hunter: { name: "猎人", description: "被狼刀或放逐出局时可以开枪带走一人，也可以不开枪；被毒死不能开枪。" },
  villager: { name: "平民", description: "没有夜间技能，请观察发言并找出狼人。" },
};

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

function publicPlayer(player: Player) {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    isHost: player.isHost,
  };
}

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 12;
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
  for (let index = 0; index < MAX_PLAYERS; index += 1) {
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

function voteTally(game: GameState): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(game.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  return tally;
}

function roomView(room: Room, viewer: Player) {
  const prompt = room.activePrompt;
  const game = room.game;
  const aliveCount = game
    ? Object.keys(game.roles).filter(id => !game.deadPlayerIds.includes(id)).length
    : 0;
  const votesRequired = game
    ? Object.keys(game.roles).filter(
        playerId =>
          !game.deadPlayerIds.includes(playerId) &&
          (game.phase !== "day_pk" || !game.pkCandidateIds.includes(playerId)),
      ).length
    : 0;
  return {
    roomId: room.id,
    viewer: { playerId: viewer.id, isHost: viewer.isHost },
    players: room.players.map(publicPlayer),
    defaultRoleDeck: !game
      ? (room.players.length >= MIN_PLAYERS
          ? configFromPlayerCount(room.players.length).roleDeck
          : room.config.roleDeck)
      : undefined,
    roleCatalog: !game
      ? Object.entries(ROLE_INFO).map(([id, info]) => ({ id, name: info.name }))
      : undefined,
    game: {
      phase: game?.phase ?? "lobby",
      canStart:
        !game &&
        room.players.length >= MIN_PLAYERS &&
        room.players.every(player => player.connected),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      confirmedRoles: game?.confirmedRolePlayerIds.length ?? 0,
      completedNightSteps: game
        ? (["night_guard", "night_werewolf", "night_witch", "night_seer", "night_complete"] as const)
            .indexOf(game.phase as "night_werewolf" | "night_guard" | "night_witch" | "night_seer" | "night_complete")
        : 0,
      dayNumber: game?.dayNumber ?? 0,
      nightNumber: game?.nightNumber ?? 0,
      aliveCount,
      votesRequired,
      votesCast: game ? Object.keys(game.votes).length : 0,
      // Tally shown to host during day_vote, day_pk, and day_result
      voteTally: viewer.isHost && game &&
        ["day_vote", "day_pk", "day_result"].includes(game.phase)
        ? voteTally(game)
        : undefined,
      pkCandidateIds: game?.pkCandidateIds ?? [],
      eliminatedTodayId: game?.eliminatedTodayId,
      noKillToday: game?.noKillToday ?? false,
      winner: game?.winner,
      deadPlayerIds: game?.deadPlayerIds ?? [],
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

function playerGameView(room: Room, player: Player) {
  const game = room.game;
  if (!game) return { phase: "lobby", mode: "lobby" };

  const role = game.roles[player.id]!;
  const base = {
    phase: game.phase,
    role,
    roleName: ROLE_INFO[role].name,
    roleDescription: ROLE_INFO[role].description,
    actionId: game.actionId,
    deadPlayerIds: game.deadPlayerIds,
  };

  if (game.phase === "role_reveal") {
    const roleConfirmed = game.confirmedRolePlayerIds.includes(player.id);
    return { ...base, mode: roleConfirmed ? "waiting" : "role_reveal", roleConfirmed };
  }

  const targetViews = room.players.map(publicPlayer);
  const alive = (t: ReturnType<typeof publicPlayer>) => !game.deadPlayerIds.includes(t.id);
  const isDead = game.deadPlayerIds.includes(player.id);

  if (game.phase === "night_werewolf" && role === "werewolf" && !isDead) {
    return {
      ...base,
      mode: "wolf_action",
      targets: targetViews.filter(alive),
    };
  }

  if (game.phase === "night_guard" && role === "guard" && !isDead) {
    return {
      ...base,
      mode: "guard_action",
      targets: targetViews.filter(t => alive(t) && t.id !== game.guardLastProtectedId),
    };
  }

  if (game.phase === "night_witch" && role === "witch" && !isDead) {
    return {
      ...base,
      mode: "witch_action",
      attackedPlayer: targetViews.find(target => target.id === game.wolfTargetId),
      poisonTargets: targetViews.filter(t => alive(t) && t.id !== player.id),
      antidoteAvailable: !game.witchAntidoteSpent && Boolean(game.wolfTargetId),
      poisonAvailable: !game.witchPoisonSpent,
    };
  }

  if (game.phase === "night_seer" && role === "seer" && !isDead) {
    const checkedPlayer = targetViews.find(target => target.id === game.seerTargetId);
    return {
      ...base,
      mode: game.seerTargetId ? "seer_result" : "seer_action",
      targets: targetViews.filter(t => alive(t) && t.id !== player.id),
      checkedPlayer,
      checkedAlignment: game.seerTargetId
        ? game.roles[game.seerTargetId] === "werewolf"
          ? "werewolf"
          : "good"
        : undefined,
    };
  }

  if (game.phase === "night_start") {
    return { ...base, mode: "night_start" };
  }

  if (game.phase === "night_complete") {
    return {
      ...base,
      mode: "night_complete",
      deaths: targetViews.filter(target => game.deaths.includes(target.id)),
    };
  }

  const deathViews = targetViews.filter(target => game.deaths.includes(target.id));

  if (game.phase === "day_vote") {
    if (isDead) return { ...base, mode: "spectator", deaths: deathViews };
    const myVote = game.votes[player.id];
    return {
      ...base,
      mode: "day_vote",
      deaths: deathViews,
      targets: targetViews.filter(t => alive(t) && t.id !== player.id),
      myVote,
    };
  }

  if (game.phase === "day_pk") {
    if (isDead) return { ...base, mode: "spectator", deaths: deathViews };
    if (game.pkCandidateIds.includes(player.id)) {
      return { ...base, mode: "waiting", deaths: deathViews };
    }
    const myVote = game.votes[player.id];
    return {
      ...base,
      mode: "day_pk",
      deaths: deathViews,
      targets: targetViews.filter(
        target => alive(target) && target.id !== player.id && game.pkCandidateIds.includes(target.id),
      ),
      myVote,
    };
  }

  if (game.phase === "day_result") {
    const eliminatedPlayer = game.eliminatedTodayId
      ? targetViews.find(t => t.id === game.eliminatedTodayId)
      : undefined;
    return {
      ...base,
      mode: "day_result",
      deaths: deathViews,
      eliminatedPlayer,
      noKill: game.noKillToday ?? false,
    };
  }

  if (game.phase === "day_hunter") {
    if (role === "hunter") {
      return {
        ...base,
        mode: "hunter_execution",
        targets: targetViews.filter(target => !game.deadPlayerIds.includes(target.id)),
      };
    }
    if (game.hunterTrigger === "night") {
      return { ...base, mode: "day_announce", deaths: deathViews };
    }
    return { ...base, mode: "waiting" };
  }

  if (game.phase === "game_over") {
    return {
      ...base,
      mode: "game_over",
      winner: game.winner,
    };
  }

  return { ...base, mode: "waiting" };
}

function sendPrivateState(io: Server, room: Room, player: Player): void {
  if (!player.socketId) return;
  io.to(player.socketId).emit("player:game-state", playerGameView(room, player));
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
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("room:state", roomView(room, player));
    sendPrivateState(io, room, player);
  }
}

function actingPlayerIds(game: GameState): string[] {
  if (game.phase === "day_vote") {
    return Object.keys(game.roles).filter(id => !game.deadPlayerIds.includes(id));
  }
  if (game.phase === "day_pk") {
    return Object.keys(game.roles).filter(
      id => !game.deadPlayerIds.includes(id) && !game.pkCandidateIds.includes(id),
    );
  }
  if (game.phase === "day_hunter") {
    return Object.entries(game.roles)
      .filter(([, r]) => r === "hunter")
      .map(([id]) => id);
  }
  const role =
    game.phase === "night_werewolf" ? "werewolf"
    : game.phase === "night_guard" ? "guard"
    : game.phase === "night_witch" ? "witch"
    : game.phase === "night_seer" ? "seer"
    : undefined;
  return role
    ? Object.entries(game.roles)
        .filter(
          ([playerId, assignedRole]) =>
            assignedRole === role && !game.deadPlayerIds.includes(playerId),
        )
        .map(([playerId]) => playerId)
    : [];
}

function alertCurrentActors(io: Server, room: Room, resumed = false): void {
  if (!room.game) return;
  for (const playerId of actingPlayerIds(room.game)) {
    const player = room.players.find(item => item.id === playerId);
    if (player?.socketId) {
      io.to(player.socketId).emit("player:action-alert", {
        actionId: room.game.actionId,
        phase: room.game.phase,
        resumed,
      });
    }
  }
}

function afterNightAction(io: Server, room: Room): void {
  const game = room.game;
  if (!game) return;

  if (game.phase === "game_over") {
    broadcastRoom(io, room);
    io.to(room.id).emit("game:over", { winner: game.winner });
    return;
  }
  if (game.phase === "night_complete") {
    io.to(room.id).emit("game:night-complete", { actionId: game.actionId });
    startDayVote(game);
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

function afterCloseDayVote(io: Server, room: Room, result: string): void {
  if (!room.game) return;
  const { phase } = room.game;
  if (phase === "game_over") {
    io.to(room.id).emit("game:over", { winner: room.game.winner });
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
    message: error instanceof GameRuleError ? error.message : "操作失败，请重试",
  });
}

export function createGameServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map<string, Room>();

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

  io.on("connection", (socket: Socket) => {
    socket.on("host:create-room", (data: { name?: string }, ack: ClientAck<unknown>) => {
      try {
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        const roomId = createRoomId(rooms);
        const session = createSessionToken();
        const host: Player = {
          id: crypto.randomUUID(),
          name: requestedPlayerName(undefined, data.name),
          seat: 1,
          socketId: socket.id,
          connected: true,
          isHost: true,
          resumeTokenHash: session.hash,
        };
        const room: Room = { id: roomId, players: [host], createdAt: Date.now(), config: DEFAULT_GAME_CONFIG };
        rooms.set(roomId, room);
        void socket.join(roomId);
        ack({
          ok: true,
          roomId,
          playerId: host.id,
          seat: host.seat,
          name: host.name,
          resumeToken: session.token,
        });
        broadcastRoom(io, room);
      } catch {
        ack({ ok: false, message: "创建房间失败" });
      }
    });

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
        if (room.players.length >= MAX_PLAYERS) {
          return ack({ ok: false, message: `房间最多${MAX_PLAYERS}人` });
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
        ack({
          ok: true,
          roomId,
          playerId: player.id,
          seat: player.seat,
          name: player.name,
          resumeToken: session.token,
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
        });
        broadcastRoom(io, room);
        sendCurrentTestPrompt(socket, room, player);
        if (room.game && actingPlayerIds(room.game).includes(player.id)) {
          alertCurrentActors(io, room, true);
        }
      },
    );

    socket.on("host:start-game", (data: { roleDeck?: Role[] } | undefined, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以开始游戏" });
      const { room } = membership;
      if (room.game) return ack({ ok: false, message: "游戏已经开始" });
      if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
        return ack({ ok: false, message: `需要${MIN_PLAYERS}到${MAX_PLAYERS}名玩家才能开始` });
      }
      if (room.players.some(player => !player.connected)) {
        return ack({ ok: false, message: "所有玩家在线后才能开始" });
      }

      try {
        const gameConfig = data?.roleDeck
          ? configFromRoleDeck(room.players.length, data.roleDeck)
          : configFromPlayerCount(room.players.length);
        room.config = gameConfig;
        room.game = startGame(room.players.map(player => player.id), gameConfig);
        delete room.activePrompt;
        broadcastRoom(io, room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

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
      if (membership.room.players.length === 0) rooms.delete(membership.room.id);
      else broadcastRoom(io, membership.room);
      ack({ ok: true });
    });

    socket.on("player:confirm-role", (data: { actionId?: string }, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        const allConfirmed = confirmRole(membership.room.game, membership.player.id, data.actionId);
        broadcastRoom(io, membership.room);
        // All roles confirmed → night_start; host will click to begin the night
        if (allConfirmed) {
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
        if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const advanced = submitWolfTarget(
            membership.room.game,
            membership.player.id,
            data.targetPlayerId,
            data.actionId,
          );
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
        if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const action: { useAntidote?: boolean; poisonTargetId?: string | null } = {};
          if (data.useAntidote !== undefined) action.useAntidote = data.useAntidote;
          if (data.poisonTargetId !== undefined) action.poisonTargetId = data.poisonTargetId;
          const advanced = submitWitchAction(
            membership.room.game,
            membership.player.id,
            action,
            data.actionId,
          );
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
        if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          submitSeerTarget(
            membership.room.game,
            membership.player.id,
            data.targetPlayerId,
            data.actionId,
          );
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

    socket.on("player:confirm-seer-result", (data: { actionId?: string }, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        const advanced = confirmSeerResult(
          membership.room.game,
          membership.player.id,
          data.actionId,
        );
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
        if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const advanced = submitGuardTarget(
            membership.room.game,
            membership.player.id,
            data.targetPlayerId,
            data.actionId,
          );
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
        if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const advanced = submitHunterExecution(
            membership.room.game,
            membership.player.id,
            data.targetPlayerId,
            data.actionId,
          );
          if (advanced) {
            const { game } = membership.room;
            if (game.phase === "game_over") {
              broadcastRoom(io, membership.room);
              io.to(membership.room.id).emit("game:over", { winner: game.winner });
            } else if (game.phase === "night_complete") {
              // The night death was already announced before the hunter acted.
              startDayVote(game);
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
      if (!membership.room.game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        startNight(membership.room.game);
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
        if (!membership?.room.game) return ack({ ok: false, message: "游戏尚未开始" });
        try {
          const changed = submitVote(
            membership.room.game,
            membership.player.id,
            data.targetId ?? "",
            data.actionId ?? "",
          );
          if (changed) {
            broadcastRoom(io, membership.room);
            // Auto-close when all alive players have voted
            if (allAliveVoted(membership.room.game)) {
              const result = closeDayVote(membership.room.game);
              broadcastRoom(io, membership.room);
              afterCloseDayVote(io, membership.room, result);
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
      if (!membership.room.game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        const result = closeDayVote(membership.room.game);
        broadcastRoom(io, membership.room);
        afterCloseDayVote(io, membership.room, result);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on("host:begin-night-start", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以操作" });
      if (!membership.room.game) return ack({ ok: false, message: "游戏尚未开始" });
      try {
        beginNightStart(membership.room.game);
        broadcastRoom(io, membership.room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on("host:restart-game", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以重新开始游戏" });
      if (!membership.room.game) return ack({ ok: false, message: "游戏尚未开始" });
      const { room } = membership;
      const gameConfig = room.config.playerCount === room.players.length
        ? room.config
        : configFromPlayerCount(room.players.length);
      room.config = gameConfig;
      room.game = startGame(room.players.map(player => player.id), gameConfig);
      delete room.activePrompt;
      broadcastRoom(io, room);
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
      broadcastRoom(io, membership.room);
    });
  });

  return { app, httpServer, io, rooms };
}

const port = Number(process.env.PORT ?? 3000);
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntryPoint) {
  const { httpServer } = createGameServer();
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`服务运行于 http://localhost:${port}`);
  });
}
