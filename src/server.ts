import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
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
};

type ClientAck<T> = (response: T) => void;
type BasicAck = ClientAck<{ ok: true } | { ok: false; message: string }>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devDirectory = path.join(__dirname, "../dev");

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

function roomView(room: Room, viewer: Player) {
  const prompt = room.activePrompt;
  return {
    roomId: room.id,
    viewer: { playerId: viewer.id, isHost: viewer.isHost },
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      isHost: player.isHost,
    })),
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

function broadcastRoom(io: Server, room: Room): void {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("room:state", roomView(room, player));
  }
}

function sendCurrentPrivateState(socket: Socket, room: Room, player: Player): void {
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
      if (findMembership(rooms, socket.id)) return ack({ ok: false, message: "当前连接已经加入房间" });
      if (!room) return ack({ ok: false, message: "房间不存在" });
      if (room.players.length >= 20) return ack({ ok: false, message: "房间人数已满" });

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
      sendCurrentPrivateState(socket, room, player);
    },
  );

  socket.on(
    "host:send-test-prompt",
    (data: { targetPlayerId?: string }, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以发送提醒" });
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
    if (!membership || !prompt || prompt.id !== data.promptId || prompt.targetPlayerId !== membership.player.id) {
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
      if (!membership || !prompt || prompt.id !== data.promptId || prompt.targetPlayerId !== membership.player.id) {
        return ack({ ok: false, message: "提醒已失效" });
      }
      if (data.choice !== "选项一" && data.choice !== "选项二") {
        return ack({ ok: false, message: "请选择一个有效选项" });
      }
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
    console.log(`服务器运行于 http://localhost:${port}`);
  });
}
