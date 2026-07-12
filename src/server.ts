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

type Player = {
  id: string;
  name: string;
  seat: number;
  socketId: string;
  connected: boolean;
  isHost: boolean;
};

type Room = {
  id: string;
  players: Player[];
  createdAt: number;
  activePrompt?: TestPrompt;
};

type ClientAck<T> = (response: T) => void;
type BasicAck = ClientAck<{ ok: true } | { ok: false; message: string }>;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map<string, Room>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../public")));
app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, time: new Date().toISOString() });
});

function createRoomId(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomId = String(crypto.randomInt(100000, 1000000));
    if (!rooms.has(roomId)) return roomId;
  }
  throw new Error("暂时无法创建房间号");
}

function findMembership(socketId: string) {
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

function broadcastRoom(room: Room): void {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("room:state", roomView(room, player));
  }
}

io.on("connection", (socket: Socket) => {
  socket.on("host:create-room", (data: { name?: string }, ack: ClientAck<unknown>) => {
    try {
      const roomId = createRoomId();
      const host: Player = {
        id: crypto.randomUUID(),
        name: data.name?.trim() || "房主",
        seat: 1,
        socketId: socket.id,
        connected: true,
        isHost: true,
      };
      const room: Room = { id: roomId, players: [host], createdAt: Date.now() };
      rooms.set(roomId, room);
      void socket.join(roomId);
      ack({ ok: true, roomId, playerId: host.id });
      broadcastRoom(room);
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
      if (!room) return ack({ ok: false, message: "房间不存在" });
      if (room.players.length >= 20) return ack({ ok: false, message: "房间人数已满" });

      const player: Player = {
        id: crypto.randomUUID(),
        name,
        seat: room.players.length + 1,
        socketId: socket.id,
        connected: true,
        isHost: false,
      };
      room.players.push(player);
      void socket.join(roomId);
      ack({ ok: true, roomId, playerId: player.id, seat: player.seat });
      broadcastRoom(room);
    },
  );

  socket.on(
    "host:send-test-prompt",
    (data: { targetPlayerId?: string }, ack: BasicAck) => {
      const membership = findMembership(socket.id);
      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以发送提醒" });
      const target = membership.room.players.find(player => player.id === data.targetPlayerId);
      if (!target || target.isHost) return ack({ ok: false, message: "请选择一名在线玩家" });
      if (!target.connected || !target.socketId) return ack({ ok: false, message: "该玩家当前离线" });

      const prompt = createTestPrompt(target.id);
      membership.room.activePrompt = prompt;
      io.to(target.socketId).emit("player:test-prompt", { promptId: prompt.id });
      broadcastRoom(membership.room);
      ack({ ok: true });
    },
  );

  socket.on("player:ack-test-prompt", (data: { promptId?: string }, ack: BasicAck) => {
    const membership = findMembership(socket.id);
    const prompt = membership?.room.activePrompt;
    if (!membership || !prompt || prompt.id !== data.promptId || prompt.targetPlayerId !== membership.player.id) {
      return ack({ ok: false, message: "提醒已失效" });
    }
    membership.room.activePrompt = acknowledgePrompt(prompt);
    broadcastRoom(membership.room);
    ack({ ok: true });
  });

  socket.on(
    "player:submit-test-choice",
    (data: { promptId?: string; choice?: string }, ack: BasicAck) => {
      const membership = findMembership(socket.id);
      const prompt = membership?.room.activePrompt;
      if (!membership || !prompt || prompt.id !== data.promptId || prompt.targetPlayerId !== membership.player.id) {
        return ack({ ok: false, message: "提醒已失效" });
      }
      if (data.choice !== "选项一" && data.choice !== "选项二") {
        return ack({ ok: false, message: "请选择一个有效选项" });
      }
      try {
        membership.room.activePrompt = submitPrompt(prompt, data.choice);
        broadcastRoom(membership.room);
        ack({ ok: true });
      } catch {
        ack({ ok: false, message: "请先确认收到提醒" });
      }
    },
  );

  socket.on("disconnect", () => {
    const membership = findMembership(socket.id);
    if (!membership) return;
    membership.player.connected = false;
    membership.player.socketId = "";
    broadcastRoom(membership.room);
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`服务器运行于 http://localhost:${port}`);
});
