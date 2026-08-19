import type { Server, Socket } from "socket.io";
import { GameRuleError } from "../../domain/game.js";
import { parseWerewolfClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import {
  isWerewolfLifecycleClientCommand,
  parseWerewolfLifecycleClientCommandEnvelope,
} from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import { executeNodeClientProtocolCommand } from "./NodeClientProtocolAdapter.js";
import { executeNodeWerewolfLifecycleCommand } from "./NodeWerewolfLifecycleProtocolAdapter.js";
import type { RuntimeRoom, WerewolfCommandOutcome } from "./roomBridge.js";
import {
  emitActionAlertEffects,
  emitGameOverEffects,
  emitNightCompleteEffects,
} from "./SocketIoClientEffectDelivery.js";
import {
  currentClientStateDelivery,
  type ClientStateDelivery,
} from "./SocketIoClientStateDelivery.js";
import { runHostCommand } from "./werewolfCommandFacade.js";

type BasicResult = { ok: true } | { ok: false; message: string };
type BasicAck = (result: BasicResult) => void;
type ClientStateSyncResult =
  | ({ ok: true } & ClientStateDelivery)
  | { ok: false; message: string };

type ProtocolTransportServer = {
  io: Server;
  rooms: Map<string, RuntimeRoom>;
  delivery: {
    broadcastRoom(room: RuntimeRoom): void;
  };
};

function findMembership(rooms: Map<string, RuntimeRoom>, socketId: string) {
  for (const room of rooms.values()) {
    const player = room.players.find(item => item.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}

function afterNightAction(
  io: Server,
  room: RuntimeRoom,
  broadcastRoom: (room: RuntimeRoom) => void,
): void {
  const game = room.game;
  if (!game) return;

  if (game.phase === "game_over") {
    broadcastRoom(room);
    emitGameOverEffects(io, room);
    return;
  }

  if (game.phase === "night_complete") {
    emitNightCompleteEffects(io, room);
    runHostCommand(room, { type: "startDayVote" });
    broadcastRoom(room);
    emitActionAlertEffects(io, room);
    return;
  }

  if (game.phase === "day_hunter" && game.hunterTrigger === "night") {
    emitNightCompleteEffects(io, room);
    broadcastRoom(room);
    emitActionAlertEffects(io, room);
    return;
  }

  broadcastRoom(room);
  emitActionAlertEffects(io, room);
}

function afterCloseDayVote(io: Server, room: RuntimeRoom): void {
  if (!room.game) return;
  if (room.game.phase === "game_over") {
    emitGameOverEffects(io, room);
  } else if (room.game.phase === "day_hunter" || room.game.phase === "day_pk") {
    emitActionAlertEffects(io, room);
  }
}

function deliverCommandOutcome(
  io: Server,
  room: RuntimeRoom,
  broadcastRoom: (room: RuntimeRoom) => void,
  execution: { outcome: WerewolfCommandOutcome; replayed: boolean },
): void {
  if (execution.replayed) return;

  const { outcome } = execution;
  switch (outcome.kind) {
    case "none":
      return;

    case "broadcast":
      broadcastRoom(room);
      return;

    case "afterNightAction":
      afterNightAction(io, room, broadcastRoom);
      return;

    case "hunterResolved":
      if (!room.game) return;
      if (room.game.phase === "game_over") {
        broadcastRoom(room);
        emitGameOverEffects(io, room);
      } else if (room.game.phase === "night_complete") {
        runHostCommand(room, { type: "startDayVote" });
        broadcastRoom(room);
        emitActionAlertEffects(io, room);
      } else {
        broadcastRoom(room);
      }
      return;

    case "vote":
      if (!outcome.changed) return;
      broadcastRoom(room);
      if (outcome.allEligibleVoted) {
        const closeOutcome = runHostCommand(room, { type: "closeDayVote" });
        broadcastRoom(room);
        if (closeOutcome.kind === "voteClosed") afterCloseDayVote(io, room);
      }
      return;

    case "voteClosed":
      broadcastRoom(room);
      afterCloseDayVote(io, room);
      return;
  }
}

function ruleMessage(error: unknown): string {
  return error instanceof GameRuleError ? error.message : "操作失败，请重试";
}

/**
 * E2 Socket.IO transport for versioned client protocol traffic.
 *
 * `client:command` carries E1 command envelopes. Canonical private PlayerView
 * pushes are delivered directly by SocketIoClientStateDelivery; this transport
 * only serves explicit `client:sync-state` reconciliation and command handling.
 */
export function attachSocketIoClientProtocolTransport(
  server: ProtocolTransportServer,
): void {
  const { io, rooms, delivery } = server;

  io.on("connection", (socket: Socket) => {
    socket.on(
      "client:sync-state",
      (_value: unknown, ack: (result: ClientStateSyncResult) => void) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) {
          return ack({ ok: false, message: "你当前不在房间中" });
        }
        ack({
          ok: true,
          ...currentClientStateDelivery(membership.room, membership.player.id),
        });
      },
    );

    socket.on("client:command", async (value: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership) {
        return ack({ ok: false, message: "你当前不在房间中" });
      }

      try {
        const execution = isWerewolfLifecycleClientCommand(value)
          ? await executeNodeWerewolfLifecycleCommand(
              membership.room,
              membership.player.id,
              parseWerewolfLifecycleClientCommandEnvelope(value),
            )
          : await (async () => {
              if (!membership.room.game) {
                throw new GameRuleError("游戏尚未开始");
              }
              return executeNodeClientProtocolCommand(
                membership.room,
                membership.player.id,
                parseWerewolfClientCommandEnvelope(value),
              );
            })();

        deliverCommandOutcome(
          io,
          membership.room,
          delivery.broadcastRoom,
          execution,
        );
        ack({ ok: true });
      } catch (error) {
        ack({ ok: false, message: ruleMessage(error) });
      }
    });
  });
}
