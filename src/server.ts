import path from "node:path";
import { fileURLToPath } from "node:url";
import { onlineActingPlayers } from "./runtime/node/hostRecovery.js";
import { runHostRecoveryCommandIdempotent } from "./runtime/node/werewolfCommandFacade.js";
import {
  createGameServer as createBaseGameServer,
  type Room as ServerRoom,
} from "./serverCore.js";

export type { Player, Room } from "./serverCore.js";

type BasicAck = (response: { ok: true } | { ok: false; message: string }) => void;

function findMembership(rooms: Map<string, ServerRoom>, socketId: string) {
  for (const room of rooms.values()) {
    const player = room.players.find(item => item.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}

function requiredCommandId(data: { commandId?: string } | undefined, ack: BasicAck): string | null {
  const commandId = data?.commandId?.trim();
  if (commandId) return commandId;
  ack({ ok: false, message: "缺少有效的 commandId，请重试" });
  return null;
}

export function createGameServer() {
  const game = createBaseGameServer();
  const { io, rooms } = game;

  io.on("connection", socket => {
    socket.on(
      "host:resend-current-action",
      async (data: { commandId?: string } | undefined, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以重新提醒当前行动" });
        }
        if (!membership.room.game) {
          return ack({ ok: false, message: "游戏尚未开始" });
        }

        const commandId = requiredCommandId(data, ack);
        if (!commandId) return;

        const { room } = membership;
        try {
          await runHostRecoveryCommandIdempotent(room, commandId, () => {
            const actors = onlineActingPlayers(room);
            if (actors.length === 0) {
              throw new Error("当前没有在线的行动玩家需要提醒");
            }

            for (const actor of actors) {
              io.to(actor.socketId!).emit("player:action-alert", {
                actionId: room.game!.actionId,
                phase: room.game!.phase,
                resumed: true,
              });
            }

            return {
              kind: "hostRecoveryReminder",
              actorPlayerIds: actors.map(actor => actor.id),
            };
          });

          ack({ ok: true });
        } catch (error) {
          ack({
            ok: false,
            message:
              error instanceof Error && error.message === "当前没有在线的行动玩家需要提醒"
                ? error.message
                : "重新提醒失败，请重试",
          });
        }
      },
    );
  });

  return game;
}

const __filename = fileURLToPath(import.meta.url);
const port = Number(process.env.PORT ?? 3000);
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntryPoint) {
  const { httpServer } = createGameServer();
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`服务运行于 http://localhost:${port}`);
  });
}
