import { hasGameModeratorControl } from "../../core/room/GameModerator.js";
import type { WerewolfClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import { mapWerewolfClientCommand } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import {
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import { createWerewolfClientRoomProjection } from "../shared/werewolfClientRoomProjection.js";
import type { WerewolfCommandEnvironment } from "../shared/werewolfRoomCommand.js";
import { werewolfPlayerGameView } from "../shared/werewolfRoomView.js";
import type { RuntimeRoom } from "./roomBridge.js";
import {
  runModeratorCommandIdempotent,
  runPlayerCommandIdempotent,
} from "./werewolfCommandFacade.js";

/**
 * E1 Node mapping from transport-neutral client protocol to the existing
 * authoritative command boundary. Socket.IO handlers remain untouched until E2.
 */
export function executeNodeClientProtocolCommand(
  room: RuntimeRoom,
  authenticatedPlayerId: string,
  envelope: WerewolfClientCommandEnvelope,
  environment?: WerewolfCommandEnvironment,
) {
  const member = room.players.find(player => player.id === authenticatedPlayerId);
  if (!member) throw new Error("authenticated player is not a room member");

  const mapped = mapWerewolfClientCommand(envelope);
  if (mapped.authority === "moderator") {
    if (!hasGameModeratorControl(room.gameModerator, member)) {
      throw new Error("game command requires moderator authority");
    }
    return runModeratorCommandIdempotent(
      room,
      mapped.commandId,
      mapped.command,
      environment,
    );
  }

  return runPlayerCommandIdempotent(
    room,
    authenticatedPlayerId,
    mapped.commandId,
    mapped.command,
    environment,
  );
}

export function createNodeRoomStateEnvelope(
  room: RuntimeRoom,
  playerId: string,
) {
  return createRoomStateEnvelope(
    room.id,
    createWerewolfClientRoomProjection(
      room,
      playerId,
      {
        isPlayerConnected: candidatePlayerId => {
          const player = room.players.find(item => item.id === candidatePlayerId);
          return Boolean(player?.connected && player.socketId);
        },
      },
    ),
  );
}

export function createNodePlayerStateEnvelope(
  room: RuntimeRoom,
  playerId: string,
) {
  if (!room.players.some(player => player.id === playerId)) {
    throw new Error("player is not a room member");
  }
  return createPlayerStateEnvelope(
    room.id,
    playerId,
    werewolfPlayerGameView(room, playerId),
  );
}
