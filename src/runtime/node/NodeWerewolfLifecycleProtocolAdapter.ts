import {
  gameParticipantPlayers,
  hasGameModeratorControl,
} from "../../core/room/GameModerator.js";
import {
  configFromPlayerCount,
  configFromRoleDeck,
  GameRuleError,
} from "../../games/werewolf/WerewolfDomainFacade.js";
import {
  WEREWOLF_MAX_PLAYERS,
  WEREWOLF_MIN_PLAYERS,
  isWerewolfPlayerCountSupported,
} from "../../games/werewolf/WerewolfLobbyPolicy.js";
import type { WerewolfLifecycleClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import {
  createWerewolfGame,
  type RuntimeRoom,
} from "./roomBridge.js";
import { runModeratorLifecycleMutationIdempotent } from "./werewolfCommandFacade.js";

export function executeNodeWerewolfLifecycleCommand(
  room: RuntimeRoom,
  authenticatedPlayerId: string,
  envelope: WerewolfLifecycleClientCommandEnvelope,
) {
  const member = room.players.find(player => player.id === authenticatedPlayerId);
  if (!member) throw new Error("authenticated player is not a room member");
  if (!hasGameModeratorControl(room.gameModerator, member)) {
    throw new Error("game command requires moderator authority");
  }
  const participants = gameParticipantPlayers(room);

  if (envelope.type === "werewolf.startGame") {
    return runModeratorLifecycleMutationIdempotent(room, envelope.commandId, () => {
      if (room.game) throw new GameRuleError("游戏已经开始");
      if (!isWerewolfPlayerCountSupported(participants.length)) {
        throw new GameRuleError(
          `需要${WEREWOLF_MIN_PLAYERS}到${WEREWOLF_MAX_PLAYERS}名玩家才能开始`,
        );
      }
      if (participants.some(player => !player.connected)) {
        throw new GameRuleError("所有玩家在线后才能开始");
      }

      const gameConfig = envelope.payload.roleDeck
        ? configFromRoleDeck(participants.length, envelope.payload.roleDeck)
        : configFromPlayerCount(participants.length);
      createWerewolfGame(room, gameConfig);
      delete room.activePrompt;
      return { kind: "broadcast" };
    });
  }

  return runModeratorLifecycleMutationIdempotent(room, envelope.commandId, () => {
    if (!room.game) throw new GameRuleError("游戏尚未开始");
    const gameConfig =
      room.gameConfig.playerCount === participants.length
        ? room.gameConfig
        : configFromPlayerCount(participants.length);
    createWerewolfGame(room, gameConfig);
    delete room.activePrompt;
    return { kind: "broadcast" };
  });
}
