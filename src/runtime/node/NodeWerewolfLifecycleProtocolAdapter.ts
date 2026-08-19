import {
  configFromPlayerCount,
  configFromRoleDeck,
  GameRuleError,
} from "../../domain/game.js";
import type { WerewolfLifecycleClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import {
  createWerewolfGame,
  type RuntimeRoom,
} from "./roomBridge.js";
import { runHostLifecycleMutationIdempotent } from "./werewolfCommandFacade.js";

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 12;

export function executeNodeWerewolfLifecycleCommand(
  room: RuntimeRoom,
  authenticatedPlayerId: string,
  envelope: WerewolfLifecycleClientCommandEnvelope,
) {
  const member = room.players.find(player => player.id === authenticatedPlayerId);
  if (!member) throw new Error("authenticated player is not a room member");
  if (!member.isHost) throw new Error("host command requires host authority");

  if (envelope.type === "werewolf.startGame") {
    return runHostLifecycleMutationIdempotent(room, envelope.commandId, () => {
      if (room.game) throw new GameRuleError("游戏已经开始");
      if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
        throw new GameRuleError(`需要${MIN_PLAYERS}到${MAX_PLAYERS}名玩家才能开始`);
      }
      if (room.players.some(player => !player.connected)) {
        throw new GameRuleError("所有玩家在线后才能开始");
      }

      const gameConfig = envelope.payload.roleDeck
        ? configFromRoleDeck(room.players.length, envelope.payload.roleDeck)
        : configFromPlayerCount(room.players.length);
      createWerewolfGame(room, gameConfig);
      delete room.activePrompt;
      return { kind: "broadcast" };
    });
  }

  return runHostLifecycleMutationIdempotent(room, envelope.commandId, () => {
    if (!room.game) throw new GameRuleError("游戏尚未开始");
    const gameConfig =
      room.gameConfig.playerCount === room.players.length
        ? room.gameConfig
        : configFromPlayerCount(room.players.length);
    createWerewolfGame(room, gameConfig);
    delete room.activePrompt;
    return { kind: "broadcast" };
  });
}
