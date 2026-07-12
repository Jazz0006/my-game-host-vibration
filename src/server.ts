import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, Socket } from "socket.io";

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
};

type ClientAck<T> = (response: T) => void;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map<string, Room>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    time: new Date().toISOString(),
  });
});

function createRoomId(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomId = String(crypto.randomInt(100000, 1000000));

    if (!rooms.has(roomId)) {
      return roomId;
    }
  }

  throw new Error("暂时无法创建房间号");
}

function createPlayerId(): string {
  return crypto.randomUUID();
}

function getPublicRoomState(room: Room) {
  return {
    roomId: room.id,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      isHost: player.isHost,
    })),
  };
}

function broadcastRoom(room: Room): void {
  io.to(room.id).emit("room:state", getPublicRoomState(room));
}

function findPlayerBySocket(socketId: string) {
  for (const room of rooms.values()) {
    const player = room.players.find(item => item.socketId === socketId);

    if (player) {
      return { room, player };
    }
  }

  return null;
}

io.on("connection", (socket: Socket) => {
  console.log("客户端连接：", socket.id);

  socket.on(
    "host:create-room",
    (
      data: { name?: string },
      ack: ClientAck<
        | {
            ok: true;
            roomId: string;
            playerId: string;
          }
        | {
            ok: false;
            message: string;
          }
      >,
    ) => {
      try {
        const name = data.name?.trim() || "房主";
        const roomId = createRoomId();

        const host: Player = {
          id: createPlayerId(),
          name,
          seat: 1,
          socketId: socket.id,
          connected: true,
          isHost: true,
        };

        const room: Room = {
          id: roomId,
          players: [host],
          createdAt: Date.now(),
        };

        rooms.set(roomId, room);
        socket.join(roomId);

        ack({
          ok: true,
          roomId,
          playerId: host.id,
        });

        broadcastRoom(room);
        console.log(`房间 ${roomId} 已创建`);
      } catch (error) {
        console.error(error);

        ack({
          ok: false,
          message: "创建房间失败",
        });
      }
    },
  );

  socket.on(
    "player:join-room",
    (
      data: { roomId?: string; name?: string },
      ack: ClientAck<
        | {
            ok: true;
            roomId: string;
            playerId: string;
            seat: number;
          }
        | {
            ok: false;
            message: string;
          }
      >,
    ) => {
      const roomId = data.roomId?.trim();
      const name = data.name?.trim();

      if (!roomId || !name) {
        ack({
          ok: false,
          message: "请输入房间号和玩家名字",
        });
        return;
      }

      const room = rooms.get(roomId);

      if (!room) {
        ack({
          ok: false,
          message: "房间不存在",
        });
        return;
      }

      if (room.players.length >= 20) {
        ack({
          ok: false,
          message: "房间人数已满",
        });
        return;
      }

      const player: Player = {
        id: createPlayerId(),
        name,
        seat: room.players.length + 1,
        socketId: socket.id,
        connected: true,
        isHost: false,
      };

      room.players.push(player);
      socket.join(roomId);

      ack({
        ok: true,
        roomId,
        playerId: player.id,
        seat: player.seat,
      });

      broadcastRoom(room);
      console.log(`${name} 加入房间 ${roomId}`);
    },
  );

  socket.on("disconnect", reason => {
    const result = findPlayerBySocket(socket.id);

    if (!result) {
      return;
    }

    result.player.connected = false;
    result.player.socketId = "";

    broadcastRoom(result.room);

    console.log(
      `${result.player.name} 离开房间 ${result.room.id}，原因：${reason}`,
    );
  });
});

const port = Number(process.env.PORT ?? 3000);

server.listen(port, "0.0.0.0", () => {
  console.log(`服务器运行于 http://localhost:${port}`);
});