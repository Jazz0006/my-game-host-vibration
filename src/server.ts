import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import {
  gameParticipantPlayers,
  isHumanGameModerator,
} from "./core/room/GameModerator.js";
import { SessionTokenService } from "./core/session/SessionTokenService.js";
import {
  emitActionAlertEffects,
  emitGameOverEffects,
  emitNightCompleteEffects,
} from "./runtime/node/SocketIoClientEffectDelivery.js";
import {
  emitClientRoomClosed,
  emitClientRoomRemoved,
} from "./runtime/node/SocketIoClientRoomEventDelivery.js";
import { emitClientSessionReplaced } from "./runtime/node/SocketIoClientSessionEventDelivery.js";
import { emitPrivatePlayerState } from "./runtime/node/SocketIoClientStateDelivery.js";
import {
  configFromPlayerCount,
  DEFAULT_GAME_CONFIG,
  GameRuleError,
} from "./games/werewolf/WerewolfDomainFacade.js";
import {
  WEREWOLF_MAX_PLAYERS,
  WEREWOLF_MIN_PLAYERS,
  isWerewolfPlayerCountSupported,
} from "./games/werewolf/WerewolfLobbyPolicy.js";
import { werewolfRoleCatalog } from "./games/werewolf/roles/registry.js";
import {
  runModeratorCommand,
  runHostRecoveryCommandIdempotent,
} from "./runtime/node/werewolfCommandFacade.js";
import { onlineActingPlayers } from "./runtime/node/hostRecovery.js";
import {
  claimIdentityRecovery,
  invalidateIdentityRecoveryGrant,
  issueIdentityRecovery,
} from "./runtime/node/identityRecovery.js";
import {
  acknowledgePrompt,
  createTestPrompt,
  submitPrompt,
} from "./domain/testPrompt.js";
import { NodeSessionTokenCryptoProvider } from "./runtime/node/NodeSessionTokenCryptoProvider.js";
import {
  executeRoomManagementMutation,
  type RoomManagementCommandOutcome,
} from "./runtime/shared/roomManagementCommand.js";
import { requestedRoomPlayerName } from "./runtime/shared/roomPlayerNaming.js";
import {
  roomCore,
  roomGameView,
  type RuntimePlayer,
  type RuntimeRoom,
} from "./runtime/node/roomBridge.js";

export type Player = RuntimePlayer;
export type Room = RuntimeRoom;

type ClientAck<T> = (response: T) => void;
type BasicAck = ClientAck<{ ok: true } | { ok: false; message: string }>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devDirectory = path.join(__dirname, "../dev");

function createRoomId(rooms: Map<string, Room>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomId = String(crypto.randomInt(1000, 10000));
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

function requestedPlayerName(room: Room | undefined, value?: string): string {
  return requestedRoomPlayerName(room?.players ?? [], value);
}

function nodeRoomManagement(
  room: Room,
  actorPlayerId: string,
  command: Parameters<typeof executeRoomManagementMutation>[2],
): RoomManagementCommandOutcome {
  return executeRoomManagementMutation(
    room,
    actorPlayerId,
    command,
    {
      isPlayerConnected(playerId) {
        const player = room.players.find(item => item.id === playerId);
        return Boolean(player?.connected && player.socketId);
      },
    },
  );
}

function clearRemovedTestPrompt(room: Room, playerId: string): void {
  if (room.activePrompt?.targetPlayerId === playerId) delete room.activePrompt;
}

function roomView(room: Room, viewer: Player) {
  const prompt = room.activePrompt;
  const participantCount = gameParticipantPlayers(room).length;
  const isGameModerator = isHumanGameModerator(room.gameModerator, viewer.id);
  const gameView = roomGameView(room, isGameModerator);
  return {
    roomId: room.id,
    viewer: { playerId: viewer.id, isHost: viewer.isHost, isGameModerator },
    gameModerator: { ...room.gameModerator },
    players: room.players.map(publicPlayer),
    defaultRoleDeck: !room.game
      ? (isWerewolfPlayerCountSupported(participantCount)
          ? configFromPlayerCount(participantCount).roleDeck
          : room.gameConfig.roleDeck)
      : undefined,
    roleCatalog: !room.game
      ? werewolfRoleCatalog().map(({ id, name }) => ({ id, name }))
      : undefined,
    game: gameView
      ? {
          ...gameView,
          canStart: false,
          minPlayers: WEREWOLF_MIN_PLAYERS,
          maxPlayers: WEREWOLF_MAX_PLAYERS,
        }
      : {
          phase: "lobby",
          canStart:
            isWerewolfPlayerCountSupported(participantCount) &&
            gameParticipantPlayers(room).every(player => player.connected),
          minPlayers: WEREWOLF_MIN_PLAYERS,
          maxPlayers: WEREWOLF_MAX_PLAYERS,
          confirmedRoles: 0,
          completedNightSteps: 0,
          dayNumber: 0,
          nightNumber: 0,
          aliveCount: 0,
          votesRequired: 0,
          votesCast: 0,
          pkCandidateIds: [],
          noKillToday: false,
          deadPlayerIds: [],
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
  emitPrivatePlayerState(io, room, player.id);
}

function sendCurrentTestPrompt(socket: Socket, room: Room, player: Player): void {
  const prompt = room.activePrompt;
  if (!prompt || prompt.targetPlayerId !== player.id) return;
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

function afterNightAction(io: Server, room: Room): void {
  const game = room.game;
  if (!game) return;

  if (game.phase === "game_over") {
    broadcastRoom(io, room);
    emitGameOverEffects(io, room);
    return;
  }
  if (game.phase === "night_complete") {
    emitNightCompleteEffects(io, room);
    runModeratorCommand(room, { type: "startDayVote" });
    broadcastRoom(io, room);
    emitActionAlertEffects(io, room, { resumed: false });
    return;
  }
  if (game.phase === "day_hunter" && game.hunterTrigger === "night") {
    emitNightCompleteEffects(io, room);
    broadcastRoom(io, room);
    emitActionAlertEffects(io, room, { resumed: false });
    return;
  }

  broadcastRoom(io, room);
  emitActionAlertEffects(io, room, { resumed: false });
}

function afterCloseDayVote(io: Server, room: Room, result: string): void {
  if (!room.game) return;
  const { phase } = room.game;
  if (phase === "game_over") {
    emitGameOverEffects(io, room);
  } else if (phase === "day_hunter") {
    emitActionAlertEffects(io, room, { resumed: false });
  } else if (phase === "day_pk") {
    emitActionAlertEffects(io, room, { resumed: false });
  }
  void result;
}

function ruleError(ack: BasicAck, error: unknown): void {
  ack({
    ok: false,
    message: error instanceof GameRuleError ? error.message : "操作失败，请重试",
  });
}

function roomManagementError(ack: BasicAck, error: unknown): void {
  ack({
    ok: false,
    message:
      error instanceof Error && error.message
        ? error.message
        : "操作失败，请重试",
  });
}

function requiredCommandId(data: { commandId?: string }, ack: BasicAck): string | null {
  const commandId = data.commandId?.trim();
  if (commandId) return commandId;
  ack({ ok: false, message: "缺少有效的 commandId，请重试" });
  return null;
}

export function createGameServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map<string, Room>();
  const sessionTokens = new SessionTokenService(new NodeSessionTokenCryptoProvider());

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
    socket.on("host:create-room", async (data: { name?: string }, ack: ClientAck<unknown>) => {
      try {
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        const roomId = createRoomId(rooms);
        const session = await sessionTokens.createSessionToken();
        const host: Player = {
          id: crypto.randomUUID(),
          name: requestedPlayerName(undefined, data.name),
          seat: 1,
          socketId: socket.id,
          connected: true,
          isHost: true,
          resumeTokenHash: session.hash,
        };
        const now = Date.now();
        const room: Room = {
          id: roomId,
          gameType: "werewolf",
          players: [host],
          createdAt: now,
          updatedAt: now,
          gameModerator: { mode: "automatic" },
          gameConfig: DEFAULT_GAME_CONFIG,
        };
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
      async (data: { roomId?: string; name?: string }, ack: ClientAck<unknown>) => {
        const roomId = data.roomId?.trim();
        const room = roomId ? rooms.get(roomId) : undefined;
        if (!roomId) return ack({ ok: false, message: "请输入房间号" });
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        if (!room) return ack({ ok: false, message: "房间不存在" });
        if (room.game) return ack({ ok: false, message: "游戏已经开始，不能再加入" });
        if (gameParticipantPlayers(room).length >= WEREWOLF_MAX_PLAYERS) {
          return ack({
            ok: false,
            message: `房间最多${WEREWOLF_MAX_PLAYERS}人`,
          });
        }

        const name = requestedPlayerName(room, data.name);
        const session = await sessionTokens.createSessionToken().catch(() => null);
        if (!session) return ack({ ok: false, message: "加入房间失败" });
        const player = roomCore(room).addPlayer({
          id: crypto.randomUUID(),
          name,
          socketId: socket.id,
          connected: true,
          isHost: false,
          resumeTokenHash: session.hash,
        });
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
      async (
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
        if (!room || !player) {
          return ack({ ok: false, message: "恢复凭证无效" });
        }
        const validSession = await sessionTokens
          .verifySessionToken(resumeToken, player.resumeTokenHash)
          .catch(() => false);
        if (!validSession) {
          return ack({ ok: false, message: "恢复凭证无效" });
        }

        await invalidateIdentityRecoveryGrant(room, player.id, sessionTokens);
        const previousSocketId = player.socketId;
        player.socketId = socket.id;
        player.connected = true;
        void socket.join(room.id);

        if (previousSocketId && previousSocketId !== socket.id) {
          const previousSocket = io.sockets.sockets.get(previousSocketId);
          if (previousSocket) {
            const replacement = { roomId: room.id, playerId: player.id };
            emitClientSessionReplaced(previousSocket, replacement);
            previousSocket.disconnect(true);
          }
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
        if (room.game && onlineActingPlayers(room).some(actor => actor.id === player.id)) {
          emitActionAlertEffects(io, room, { resumed: true });
        }
      },
    );

    socket.on(
      "host:create-identity-recovery",
      async (
        data: { targetPlayerId?: string },
        ack: ClientAck<
          | { ok: true; recoveryCode: string; expiresAt: number }
          | { ok: false; message: string }
        >,
      ) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) {
          return ack({ ok: false, message: "只有房主可以协助恢复身份" });
        }
        try {
          const grant = await issueIdentityRecovery(
            membership.room,
            membership.player.id,
            data.targetPlayerId ?? "",
            sessionTokens,
          );
          ack({ ok: true, recoveryCode: grant.recoveryCode, expiresAt: grant.expiresAt });
        } catch (error) {
          ack({
            ok: false,
            message: error instanceof Error ? error.message : "生成恢复码失败，请重试",
          });
        }
      },
    );

    socket.on(
      "player:claim-identity-recovery",
      async (
        data: { roomId?: string; recoveryCode?: string },
        ack: ClientAck<unknown>,
      ) => {
        const roomId = data.roomId?.trim();
        const recoveryCode = data.recoveryCode?.trim();
        if (!roomId || !recoveryCode) {
          return ack({ ok: false, message: "请输入房间号和恢复码" });
        }
        if (findMembership(rooms, socket.id)) {
          return ack({ ok: false, message: "当前连接已经加入房间" });
        }
        const room = rooms.get(roomId);
        if (!room) return ack({ ok: false, message: "恢复码无效或已过期" });

        let claim;
        try {
          claim = await claimIdentityRecovery(room, recoveryCode, sessionTokens);
        } catch (error) {
          return ack({
            ok: false,
            message: error instanceof Error ? error.message : "恢复码无效或已过期",
          });
        }

        const player = room.players.find(item => item.id === claim.playerId);
        if (!player) {
          return ack({ ok: false, message: "该身份当前无法恢复，请让房主重新生成恢复码" });
        }

        player.socketId = socket.id;
        player.connected = true;
        void socket.join(room.id);

        ack({
          ok: true,
          roomId: room.id,
          playerId: player.id,
          seat: player.seat,
          name: player.name,
          isHost: false,
          resumeToken: claim.resumeToken,
        });
        broadcastRoom(io, room);
        sendCurrentTestPrompt(socket, room, player);
        if (room.game && onlineActingPlayers(room).some(actor => actor.id === player.id)) {
          emitActionAlertEffects(io, room, { resumed: true });
        }
      },
    );

    socket.on(
      "host:move-player-seat",
      (data: { targetPlayerId?: string; insertIndex?: number }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
        try {
          nodeRoomManagement(
            membership.room,
            membership.player.id,
            {
              type: "room.movePlayerSeat",
              targetPlayerId: data.targetPlayerId ?? "",
              insertIndex: data.insertIndex ?? -1,
            },
          );
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch (error) {
          roomManagementError(ack, error);
        }
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
        try {
          const outcome = nodeRoomManagement(
            membership.room,
            membership.player.id,
            { type: "room.updateName", name: data.name ?? "" },
          );
          if (outcome.kind !== "updatedName") {
            throw new Error("unexpected room-management outcome");
          }
          broadcastRoom(io, membership.room);
          ack({ ok: true, name: outcome.name });
        } catch (error) {
          ack({
            ok: false,
            message:
              error instanceof Error && error.message
                ? error.message
                : "操作失败，请重试",
          });
        }
      },
    );

    socket.on(
      "host:remove-player",
      async (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
        const target = membership.room.players.find(
          player => player.id === data.targetPlayerId,
        );
        const targetSocket = target?.socketId
          ? io.sockets.sockets.get(target.socketId)
          : undefined;
        try {
          const outcome = nodeRoomManagement(
            membership.room,
            membership.player.id,
            {
              type: "room.removePlayer",
              targetPlayerId: data.targetPlayerId ?? "",
            },
          );
          if (outcome.kind !== "removedPlayer") {
            throw new Error("unexpected room-management outcome");
          }
          await invalidateIdentityRecoveryGrant(
            membership.room,
            outcome.playerId,
            sessionTokens,
          );
          clearRemovedTestPrompt(membership.room, outcome.playerId);
          if (targetSocket) {
            emitClientRoomRemoved(targetSocket, membership.room.id);
          }
          if (process.env.NODE_ENV !== "production") {
            io.emit("dev:player-removed", {
              roomId: membership.room.id,
              playerId: outcome.playerId,
            });
          }
          if (targetSocket) void targetSocket.leave(membership.room.id);
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch (error) {
          roomManagementError(ack, error);
        }
      },
    );

    socket.on(
      "host:transfer-host",
      (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
        try {
          nodeRoomManagement(
            membership.room,
            membership.player.id,
            {
              type: "room.transferHost",
              targetPlayerId: data.targetPlayerId ?? "",
            },
          );
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch (error) {
          roomManagementError(ack, error);
        }
      },
    );

    socket.on(
      "host:leave-and-transfer",
      async (data: { targetPlayerId?: string }, ack: BasicAck) => {
        const membership = findMembership(rooms, socket.id);
        if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
        try {
          const outcome = nodeRoomManagement(
            membership.room,
            membership.player.id,
            {
              type: "room.leaveAndTransfer",
              targetPlayerId: data.targetPlayerId ?? "",
            },
          );
          if (outcome.kind !== "leftAndTransferred") {
            throw new Error("unexpected room-management outcome");
          }
          await invalidateIdentityRecoveryGrant(
            membership.room,
            outcome.leavingPlayerId,
            sessionTokens,
          );
          clearRemovedTestPrompt(membership.room, outcome.leavingPlayerId);
          void socket.leave(membership.room.id);
          broadcastRoom(io, membership.room);
          ack({ ok: true });
        } catch (error) {
          roomManagementError(ack, error);
        }
      },
    );

    socket.on("host:close-room", (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
      try {
        const outcome = nodeRoomManagement(
          membership.room,
          membership.player.id,
          { type: "room.close" },
        );
        if (outcome.kind !== "closedRoom") {
          throw new Error("unexpected room-management outcome");
        }
        rooms.delete(outcome.roomId);
        emitClientRoomClosed(io, outcome.roomId);
        io.in(outcome.roomId).socketsLeave(outcome.roomId);
        ack({ ok: true });
      } catch (error) {
        roomManagementError(ack, error);
      }
    });

    socket.on("player:leave-room", async (_data: unknown, ack: BasicAck) => {
      const membership = findMembership(rooms, socket.id);
      if (!membership) return ack({ ok: false, message: "你当前不在房间中" });
      try {
        const outcome = nodeRoomManagement(
          membership.room,
          membership.player.id,
          { type: "room.leave" },
        );
        if (outcome.kind !== "leftRoom") {
          throw new Error("unexpected room-management outcome");
        }
        await invalidateIdentityRecoveryGrant(
          membership.room,
          outcome.leavingPlayerId,
          sessionTokens,
        );
        clearRemovedTestPrompt(membership.room, outcome.leavingPlayerId);
        void socket.leave(membership.room.id);
        if (outcome.roomEmpty) rooms.delete(membership.room.id);
        else broadcastRoom(io, membership.room);
        ack({ ok: true });
      } catch (error) {
        roomManagementError(ack, error);
      }
    });

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

        const commandId = requiredCommandId(data ?? {}, ack);
        if (!commandId) return;

        const { room } = membership;
        try {
          const execution = await runHostRecoveryCommandIdempotent(
            room,
            membership.player.id,
            commandId,
            { type: "recovery.resendCurrentAction" },
            {
              isPlayerConnected(playerId) {
                const player = room.players.find(item => item.id === playerId);
                return Boolean(player?.connected && player.socketId);
              },
              now: Date.now,
            },
          );
          if (!execution.replayed) {
            emitActionAlertEffects(io, room, { resumed: true });
          }
          ack({ ok: true });
        } catch (error) {
          ruleError(ack, error);
        }
      },
    );

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

  // D1.2 Node delivery boundary. Wrappers such as timedServer may trigger
  // lifecycle/domain mutations, but they must reuse this server's canonical
  // room/player projection instead of maintaining a second roomView.
  const delivery = {
    broadcastRoom: (room: Room) => broadcastRoom(io, room),
  };

  return { app, httpServer, io, rooms, delivery };
}

const port = Number(process.env.PORT ?? 3000);
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntryPoint) {
  const { httpServer } = createGameServer();
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`服务运行于 http://localhost:${port}`);
  });
}
