import type { Server, Socket } from "socket.io";
import { GameRuleError } from "../../domain/game.js";
import { parseWerewolfClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import {
  createNodePlayerStateEnvelope,
  executeNodeClientProtocolCommand,
} from "./NodeClientProtocolAdapter.js";
import {
  advanceNodeClientStateRevision,
  currentNodeClientStateRevision,
} from "./NodeClientStateRevision.js";
import {
  actingPlayerIds,
  type RuntimeRoom,
} from "./roomBridge.js";
import { runHostCommand } from "./werewolfCommandFacade.js";

type BasicResult = { ok: true } | { ok: false; message: string };
type BasicAck = (result: BasicResult) => void;
type ClientStateDelivery = {
  revision: number;
  envelope: ReturnType<typeof createNodePlayerStateEnvelope>;
};
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

function currentPlayerStateDelivery(
  room: RuntimeRoom,
  playerId: string,
): ClientStateDelivery {
  return {
    revision: currentNodeClientStateRevision(room, playerId),
    envelope: createNodePlayerStateEnvelope(room, playerId),
  };
}

function emitProtocolPlayerState(
  socket: Socket,
  room: RuntimeRoom,
  playerId: string,
): void {
  const revision = advanceNodeClientStateRevision(room, playerId);
  socket.emit("client:state", {
    revision,
    envelope: createNodePlayerStateEnvelope(room, playerId),
  } satisfies ClientStateDelivery);
}

function alertCurrentActors(io: Server, room: RuntimeRoom): void {
  if (!room.game) return;
  for (const playerId of actingPlayerIds(room)) {
    const player = room.players.find(item => item.id === playerId);
    if (!player?.socketId) continue;
    io.to(player.socketId).emit("player:action-alert", {
      actionId: room.game.actionId,
      phase: room.game.phase,
    });
  }
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
    io.to(room.id).emit("game:over", { winner: game.winner });
    return;
  }

  if (game.phase === "night_complete") {
    io.to(room.id).emit("game:night-complete", { actionId: game.actionId });
    runHostCommand(room, { type: "startDayVote" });
    broadcastRoom(room);
    alertCurrentActors(io, room);
    return;
  }

  if (game.phase === "day_hunter" && game.hunterTrigger === "night") {
    io.to(room.id).emit("game:night-complete", { actionId: game.actionId });
    broadcastRoom(room);
    alertCurrentActors(io, room);
    return;
  }

  broadcastRoom(room);
  alertCurrentActors(io, room);
}

function afterCloseDayVote(io: Server, room: RuntimeRoom): void {
  if (!room.game) return;
  if (room.game.phase === "game_over") {
    io.to(room.id).emit("game:over", { winner: room.game.winner });
  } else if (room.game.phase === "day_hunter" || room.game.phase === "day_pk") {
    alertCurrentActors(io, room);
  }
}

function deliverCommandOutcome(
  io: Server,
  room: RuntimeRoom,
  broadcastRoom: (room: RuntimeRoom) => void,
  execution: Awaited<ReturnType<typeof executeNodeClientProtocolCommand>>,
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
        io.to(room.id).emit("game:over", { winner: room.game.winner });
      } else if (room.game.phase === "night_complete") {
        runHostCommand(room, { type: "startDayVote" });
        broadcastRoom(room);
        alertCurrentActors(io, room);
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
 * Existing one-event-per-command handlers and legacy state deliveries remain
 * registered during migration. `client:command` carries E1 command envelopes;
 * `client:state` shadows each canonical legacy private PlayerView delivery with
 * a monotonically revised E1 state envelope; `client:sync-state` returns the
 * current revised PlayerView for ClientSession reconciliation.
 */
export function attachSocketIoClientProtocolTransport(
  server: ProtocolTransportServer,
): void {
  const { io, rooms, delivery } = server;

  io.on("connection", (socket: Socket) => {
    // E2.2b compatibility seam: canonical Node broadcasts still emit
    // `player:game-state`. Mirror that delivery into the stable protocol state
    // channel without changing the existing Web UI yet.
    socket.onAnyOutgoing((event: string) => {
      if (event !== "player:game-state") return;
      const membership = findMembership(rooms, socket.id);
      if (!membership) return;
      emitProtocolPlayerState(socket, membership.room, membership.player.id);
    });

    socket.on(
      "client:sync-state",
      (_value: unknown, ack: (result: ClientStateSyncResult) => void) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) {
          return ack({ ok: false, message: "你当前不在房间中" });
        }
        ack({
          ok: true,
          ...currentPlayerStateDelivery(membership.room, membership.player.id),
        });
      },
    );

    socket.on("client:command", async (value: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership) {
        return ack({ ok: false, message: "你当前不在房间中" });
      }
      if (!membership.room.game) {
        return ack({ ok: false, message: "游戏尚未开始" });
      }

      try {
        const envelope = parseWerewolfClientCommandEnvelope(value);
        const execution = await executeNodeClientProtocolCommand(
          membership.room,
          membership.player.id,
          envelope,
        );
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
