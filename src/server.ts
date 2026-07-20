import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import {
  confirmRole,
  confirmSeerResult,
  FIVE_PLAYER_COUNT,
  GameRuleError,
  startFivePlayerGame,
  submitSeerTarget,
  submitWitchAction,
  submitWolfTarget,
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
  activePrompt?: TestPrompt;
  game?: GameState;
};

type ClientAck<T> = (response: T) => void;
type BasicAck = ClientAck<{ ok: true } | { ok: false; message: string }>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devDirectory = path.join(__dirname, "../dev");

const ROLE_INFO: Record<Role, { name: string; description: string }> = {
  werewolf: { name: "狼人", description: "夜间选择一名玩家击杀。隐藏身份直到游戏结束。" },
  seer: { name: "预言家", description: "每晚可以查验一名其他玩家的阵营。" },
  witch: { name: "女巫", description: "拥有一瓶解药和一瓶毒药，同一晚只能使用一瓶。" },
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

function nextAvailableSeat(room: Room): number {
  const occupied = new Set(room.players.map(player => player.seat));
  for (let seat = 1; seat <= FIVE_PLAYER_COUNT; seat += 1) {
    if (!occupied.has(seat)) return seat;
  }
  throw new Error("房间没有可用座位");
}

function removePlayer(room: Room, playerId: string): Player | undefined {
  const index = room.players.findIndex(player => player.id === playerId);
  if (index < 0) return undefined;
  const [removed] = room.players.splice(index, 1);
  if (room.activePrompt?.targetPlayerId === playerId) delete room.activePrompt;
  return removed;
}

function roomView(room: Room, viewer: Player) {
  const prompt = room.activePrompt;
  const game = room.game;
  return {
    roomId: room.id,
    viewer: { playerId: viewer.id, isHost: viewer.isHost },
    players: room.players.map(publicPlayer),
    game: {
      phase: game?.phase ?? "lobby",
      canStart:
        !game &&
        room.players.length === FIVE_PLAYER_COUNT &&
        room.players.every(player => player.connected),
      requiredPlayers: FIVE_PLAYER_COUNT,
      confirmedRoles: game?.confirmedRolePlayerIds.length ?? 0,
      completedNightSteps: game
        ? game.phase === "night_werewolf"
          ? 0
          : game.phase === "night_witch"
            ? 1
            : game.phase === "night_seer"
              ? 2
              : game.phase === "night_complete"
                ? 3
                : 0
        : 0,
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
  };

  if (game.phase === "role_reveal") {
    const roleConfirmed = game.confirmedRolePlayerIds.includes(player.id);
    return { ...base, mode: roleConfirmed ? "waiting" : "role_reveal", roleConfirmed };
  }

  const targetViews = room.players.map(publicPlayer);
  if (game.phase === "night_werewolf" && role === "werewolf") {
    return {
      ...base,
      mode: "wolf_action",
      targets: targetViews.filter(target => target.id !== player.id),
    };
  }

  if (game.phase === "night_witch" && role === "witch") {
    return {
      ...base,
      mode: "witch_action",
      attackedPlayer: targetViews.find(target => target.id === game.wolfTargetId),
      poisonTargets: targetViews.filter(target => target.id !== player.id),
    };
  }

  if (game.phase === "night_seer" && role === "seer") {
    const checkedPlayer = targetViews.find(target => target.id === game.seerTargetId);
    return {
      ...base,
      mode: game.seerTargetId ? "seer_result" : "seer_action",
      targets: targetViews.filter(target => target.id !== player.id),
      checkedPlayer,
      checkedAlignment: game.seerTargetId
        ? game.roles[game.seerTargetId] === "werewolf"
          ? "werewolf"
          : "good"
        : undefined,
    };
  }

  if (game.phase === "night_complete") {
    return {
      ...base,
      mode: "night_complete",
      deaths: targetViews.filter(target => game.deaths.includes(target.id)),
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
  const role =
    game.phase === "night_werewolf"
      ? "werewolf"
      : game.phase === "night_witch"
        ? "witch"
        : game.phase === "night_seer"
          ? "seer"
          : undefined;
  return role
    ? Object.entries(game.roles)
        .filter(([, assignedRole]) => assignedRole === role)
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
          name: data.name?.trim() || "房主",
          seat: 1,
          socketId: socket.id,
          connected: true,
          isHost: true,
          resumeTokenHash: session.hash,
        };
        const room: Room = { id: roomId, players: [host], createdAt: Date.now() };
        rooms.set(roomId, room);
        void socket.join(roomId);
        ack({ ok: true, roomId, playerId: host.id, seat: host.seat, resumeToken: session.token });
        broadcastRoom(io, room);
      } catch {
        ack({ ok: false, message: "创建房间失败" });
      }
    });

    socket.on(
      "player:join-room",
      (data: { roomId?: string; name?: string }, ack: ClientAck<unknown>) => {
        const roomId = data.roomId?.trim();
        const name = data.name?.trim();
        const room = roomId ? rooms.get(roomId) : undefined;
        if (!roomId || !name) return ack({ ok: false, message: "请输入房间号和玩家名字" });
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        if (!room) return ack({ ok: false, message: "房间不存在" });
        if (room.game) return ack({ ok: false, message: "游戏已经开始，不能再加入" });
        if (room.players.length >= FIVE_PLAYER_COUNT) {
          return ack({ ok: false, message: "5人房间人数已满" });
        }

        const session = createSessionToken();
        const player: Player = {
          id: crypto.randomUUID(),
          name,
          seat: nextAvailableSeat(room),
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
          isHost: player.isHost,
        });
        broadcastRoom(io, room);
        sendCurrentTestPrompt(socket, room, player);
        if (room.game && actingPlayerIds(room.game).includes(player.id)) {
          alertCurrentActors(io, room, true);
        }
      },
    );

    socket.on("host:start-game", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以开始游戏" });
      const { room } = membership;
      if (room.game) return ack({ ok: false, message: "游戏已经开始" });
      if (room.players.length !== FIVE_PLAYER_COUNT) {
        return ack({ ok: false, message: "需要恰好5名玩家才能开始" });
      }
      if (room.players.some(player => !player.connected)) {
        return ack({ ok: false, message: "所有玩家在线后才能开始" });
      }

      room.game = startFivePlayerGame(room.players.map(player => player.id));
      delete room.activePrompt;
      broadcastRoom(io, room);
      ack({ ok: true });
    });

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
        const startedNight = confirmRole(membership.room.game, membership.player.id, data.actionId);
        broadcastRoom(io, membership.room);
        if (startedNight) alertCurrentActors(io, membership.room);
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
    });

    socket.on(
      "player:submit-wolf-target",
      (data: { actionId?: string; targetPlayerId?: string }, ack: BasicAck) => {
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
            broadcastRoom(io, membership.room);
            alertCurrentActors(io, membership.room);
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
            broadcastRoom(io, membership.room);
            alertCurrentActors(io, membership.room);
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
          broadcastRoom(io, membership.room);
          io.to(membership.room.id).emit("game:night-complete", {
            actionId: membership.room.game.actionId,
          });
        }
        ack({ ok: true });
      } catch (error) {
        ruleError(ack, error);
      }
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
