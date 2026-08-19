import type { WerewolfClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import { mapWerewolfClientCommand } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import { createPlayerStateEnvelope } from "../../protocol/client/ClientProtocol.js";
import type { WerewolfCommandEnvironment } from "../shared/werewolfRoomCommand.js";
import { werewolfPlayerGameView } from "../shared/werewolfRoomView.js";
import type { RuntimeRoom } from "./roomBridge.js";
import {
  runHostCommandIdempotent,
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
  if (mapped.authority === "host") {
    if (!member.isHost) throw new Error("host command requires host authority");
    return runHostCommandIdempotent(
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
