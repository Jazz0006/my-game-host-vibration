import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server, Socket } from "socket.io";
import { GameRuleError } from "./domain/game.js";
import {
  InteractionTimeoutCoordinator,
  type InteractionTimeoutClientState,
} from "./runtime/node/InteractionTimeoutCoordinator.js";
import {
  emitClientInteractionTimeoutError,
  emitClientInteractionTimeoutState,
} from "./runtime/node/SocketIoClientInteractionTimeoutDelivery.js";
import { attachSocketIoClientProtocolTransport } from "./runtime/node/SocketIoClientProtocolTransport.js";
import { activeInteraction, type RuntimeRoom } from "./runtime/node/roomBridge.js";
import {
  emitActionAlertEffects,
  emitGameOverEffects,
  emitNightCompleteEffects,
} from "./runtime/node/SocketIoClientEffectDelivery.js";
import { recoverTimedOutWerewolfInteraction } from "./runtime/node/werewolfInteractionTimeout.js";
import {
  runHostCommand,
  runHostLifecycleMutationIdempotent,
} from "./runtime/node/werewolfCommandFacade.js";
import { createGameServer } from "./server.js";

const TIMER_TICK_MS = 200;
const EXTENSION_RECEIPT_LIMIT = 128;

type BasicResult = { ok: true } | { ok: false; message: string };
type TimeoutConfigResult =
  | { ok: true; timeoutSeconds: number }
  | { ok: false; message: string };
type ExtensionResult =
  | { ok: true; deadlineAt: number; canExtend: boolean }
  | { ok: false; message: string };

type TimedServer = ReturnType<typeof createGameServer> & {
  interactionTimeouts: InteractionTimeoutCoordinator;
  stopInteractionTimeouts: () => void;
};

function findMembership(rooms: Map<string, RuntimeRoom>, socketId: string) {
  for (const room of rooms.values()) {
    const player = room.players.find(item => item.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}

function emitTimeoutState(
  io: Server,
  room: RuntimeRoom,
  actorPlayerIds: readonly string[],
  state: InteractionTimeoutClientState,
): void {
  for (const playerId of actorPlayerIds) {
    const player = room.players.find(item => item.id === playerId);
    if (player?.socketId) {
      emitClientInteractionTimeoutState(io, player.socketId, room.id, state);
    }
  }
}

function isTimedSecretInteraction(room: RuntimeRoom): boolean {
  const phase = room.game?.phase;
  if (
    phase === "night_guard" ||
    phase === "night_werewolf" ||
    phase === "night_witch" ||
    phase === "night_seer"
  ) return true;
  return phase === "day_hunter" && room.game?.hunterTrigger === "night";
}

function afterTimedRecovery(
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
    emitActionAlertEffects(io, room, { timeoutWarning: false });
    return;
  }

  if (game.phase === "day_hunter" && game.hunterTrigger === "night") {
    emitNightCompleteEffects(io, room);
    broadcastRoom(room);
    emitActionAlertEffects(io, room, { timeoutWarning: false });
    return;
  }

  broadcastRoom(room);
  emitActionAlertEffects(io, room, { timeoutWarning: false });
}

function ruleMessage(error: unknown): string {
  return error instanceof GameRuleError ? error.message : "操作失败，请重试";
}

export function createTimedGameServer(): TimedServer {
  const base = createGameServer();
  attachSocketIoClientProtocolTransport(base);
  const { io, rooms, delivery } = base;
  const interactionTimeouts = new InteractionTimeoutCoordinator();
  const extensionReceipts = new Map<string, ExtensionResult>();
  const timeoutStateDeliveries = new Map<string, string>();

  function timeoutDeliveryKey(roomId: string, actionId: string, playerId: string): string {
    return `${roomId}:${actionId}:${playerId}`;
  }

  function forgetTimeoutDeliveries(roomId: string, actionId: string): void {
    const prefix = `${roomId}:${actionId}:`;
    for (const key of timeoutStateDeliveries.keys()) {
      if (key.startsWith(prefix)) timeoutStateDeliveries.delete(key);
    }
  }

  function clearRoomInteractionTimeout(room: RuntimeRoom): void {
    const cleared = interactionTimeouts.clear(room.id);
    if (!cleared) return;
    emitTimeoutState(io, room, cleared.actorPlayerIds, {
      active: false,
      actionId: cleared.actionId,
    });
    forgetTimeoutDeliveries(room.id, cleared.actionId);
  }

  function syncTimeoutStateToCurrentSockets(
    room: RuntimeRoom,
    actorPlayerIds: readonly string[],
    state: InteractionTimeoutClientState,
  ): void {
    const actionId = state.actionId;
    if (!actionId) return;
    for (const playerId of actorPlayerIds) {
      const player = room.players.find(item => item.id === playerId);
      if (!player?.socketId) continue;
      const key = timeoutDeliveryKey(room.id, actionId, playerId);
      if (timeoutStateDeliveries.get(key) === player.socketId) continue;
      emitClientInteractionTimeoutState(io, player.socketId, room.id, state);
      timeoutStateDeliveries.set(key, player.socketId);
    }
  }

  function rememberExtensionReceipt(key: string, result: ExtensionResult): void {
    extensionReceipts.set(key, result);
    while (extensionReceipts.size > EXTENSION_RECEIPT_LIMIT) {
      const oldest = extensionReceipts.keys().next().value as string | undefined;
      if (!oldest) break;
      extensionReceipts.delete(oldest);
    }
  }

  io.on("connection", (socket: Socket) => {
    socket.on(
      "host:get-interaction-timeout",
      (_data: unknown, ack: (result: TimeoutConfigResult) => void) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以查看超时设置" });
        }
        ack({
          ok: true,
          timeoutSeconds: interactionTimeouts.getRoomTimeoutSeconds(membership.room.id),
        });
      },
    );

    socket.on(
      "host:set-interaction-timeout",
      (
        data: { timeoutSeconds?: number },
        ack: (result: TimeoutConfigResult) => void,
      ) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以修改行动超时" });
        }
        if (membership.room.game) {
          return ack({ ok: false, message: "游戏开始后不能修改行动超时" });
        }
        const timeoutSeconds = interactionTimeouts.setRoomTimeoutSeconds(
          membership.room.id,
          Number(data.timeoutSeconds),
        );
        ack({ ok: true, timeoutSeconds });
      },
    );

    socket.on(
      "host:abort-to-lobby",
      async (data: { commandId?: string } | undefined, ack: (result: BasicResult) => void) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.player.isHost) {
          return ack({ ok: false, message: "只有房主可以中断当前游戏" });
        }

        const commandId = data?.commandId?.trim();
        if (!commandId) {
          return ack({ ok: false, message: "缺少有效的 commandId，请重试" });
        }

        const { room } = membership;
        try {
          const { replayed } = await runHostLifecycleMutationIdempotent(
            room,
            commandId,
            () => {
              if (!room.game) {
                throw new GameRuleError("游戏尚未开始");
              }
              delete room.game;
              delete room.activePrompt;
              room.updatedAt = Date.now();
              return { kind: "broadcast" };
            },
          );

          if (!replayed) {
            clearRoomInteractionTimeout(room);
            delivery.broadcastRoom(room);
          }
          ack({ ok: true });
        } catch (error) {
          ack({ ok: false, message: ruleMessage(error) });
        }
      },
    );

    socket.on(
      "player:extend-interaction-timeout",
      (
        data: { commandId?: string; actionId?: string },
        ack: (result: ExtensionResult) => void,
      ) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership?.room.game) {
          return ack({ ok: false, message: "游戏尚未开始" });
        }
        const commandId = data.commandId?.trim();
        if (!commandId) {
          return ack({ ok: false, message: "缺少有效的 commandId，请重试" });
        }
        const receiptKey = `${membership.room.id}:${membership.player.id}:${commandId}`;
        const replay = extensionReceipts.get(receiptKey);
        if (replay) return ack(replay);

        const extension = interactionTimeouts.extend(
          membership.room.id,
          data.actionId?.trim() ?? "",
          membership.player.id,
        );
        if (!extension.ok) {
          const result: ExtensionResult = { ok: false, message: extension.message };
          rememberExtensionReceipt(receiptKey, result);
          return ack(result);
        }

        const clientState = interactionTimeouts.clientState(extension.state);
        emitTimeoutState(
          io,
          membership.room,
          extension.state.actorPlayerIds,
          clientState,
        );
        for (const playerId of extension.state.actorPlayerIds) {
          const player = membership.room.players.find(item => item.id === playerId);
          if (player?.socketId) {
            timeoutStateDeliveries.set(
              timeoutDeliveryKey(membership.room.id, extension.state.actionId, playerId),
              player.socketId,
            );
          }
        }
        const result: ExtensionResult = {
          ok: true,
          deadlineAt: extension.state.deadlineAt,
          canExtend: false,
        };
        rememberExtensionReceipt(receiptKey, result);
        ack(result);
      },
    );
  });

  const interval = setInterval(() => {
    const now = Date.now();

    for (const room of rooms.values()) {
      const interaction = activeInteraction(room);
      const shouldTime = Boolean(room.game && interaction && isTimedSecretInteraction(room));

      if (!shouldTime || !room.game || !interaction) {
        clearRoomInteractionTimeout(room);
        continue;
      }

      const ensured = interactionTimeouts.ensure(
        room.id,
        room.game.actionId,
        interaction.actorPlayerIds,
        now,
      );

      if (ensured.replaced) {
        emitTimeoutState(io, room, ensured.replaced.actorPlayerIds, {
          active: false,
          actionId: ensured.replaced.actionId,
        });
        forgetTimeoutDeliveries(room.id, ensured.replaced.actionId);
      }
      if (!ensured.state) continue;

      syncTimeoutStateToCurrentSockets(
        room,
        ensured.state.actorPlayerIds,
        interactionTimeouts.clientState(ensured.state),
      );

      const state = ensured.state;
      if (now >= state.warningAt && !state.warningSent) {
        const warned = interactionTimeouts.markWarningSent(room.id, state.actionId);
        if (warned) {
          emitActionAlertEffects(io, room, { timeoutWarning: true });
          emitTimeoutState(
            io,
            room,
            warned.actorPlayerIds,
            interactionTimeouts.clientState(warned, true),
          );
        }
      }

      if (now < state.deadlineAt) continue;

      interactionTimeouts.clear(room.id);
      emitTimeoutState(io, room, state.actorPlayerIds, {
        active: false,
        actionId: state.actionId,
      });
      forgetTimeoutDeliveries(room.id, state.actionId);

      try {
        const result = recoverTimedOutWerewolfInteraction(room, state.actionId);
        if (result.recovered) {
          afterTimedRecovery(io, room, delivery.broadcastRoom);
        }
      } catch (error) {
        for (const playerId of state.actorPlayerIds) {
          const player = room.players.find(item => item.id === playerId);
          if (player?.socketId) {
            const payload = {
              roomId: room.id,
              actionId: state.actionId,
              message: ruleMessage(error),
            };
            emitClientInteractionTimeoutError(io, player.socketId, payload);
          }
        }
      }
    }
  }, TIMER_TICK_MS);
  interval.unref();

  return {
    ...base,
    interactionTimeouts,
    stopInteractionTimeouts: () => clearInterval(interval),
  };
}

const __filename = fileURLToPath(import.meta.url);
const port = Number(process.env.PORT ?? 3000);
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntryPoint) {
  const { httpServer } = createTimedGameServer();
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`服务运行于 http://localhost:${port}`);
  });
}
