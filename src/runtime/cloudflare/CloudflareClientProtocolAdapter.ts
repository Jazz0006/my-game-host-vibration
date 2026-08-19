import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import { restoreRoomSnapshot } from "../../core/room/RoomSnapshot.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import type { WerewolfClientCommandEnvelope } from "../../games/werewolf/WerewolfClientProtocol.js";
import { mapWerewolfClientCommand } from "../../games/werewolf/WerewolfClientProtocol.js";
import { createPlayerStateEnvelope } from "../../protocol/client/ClientProtocol.js";
import { werewolfPlayerGameView } from "../shared/werewolfRoomView.js";
import type { CloudflareWerewolfCommandRuntime } from "./CloudflareWerewolfCommandRuntime.js";

/**
 * E1 Cloudflare mapping for the same transport-neutral command envelope used by
 * Node. WebSocket framing is deliberately outside this adapter.
 */
export function executeCloudflareClientProtocolCommand(
  runtime: CloudflareWerewolfCommandRuntime,
  authenticatedPlayerId: string,
  envelope: WerewolfClientCommandEnvelope,
) {
  const mapped = mapWerewolfClientCommand(envelope);
  return mapped.authority === "host"
    ? runtime.executeHost(authenticatedPlayerId, mapped.commandId, mapped.command)
    : runtime.executePlayer(authenticatedPlayerId, mapped.commandId, mapped.command);
}

export function createCloudflarePlayerStateEnvelope(
  snapshot: RoomSnapshot<GameState, GameConfig, unknown, unknown, unknown>,
  playerId: string,
) {
  const restored = restoreRoomSnapshot(snapshot);
  if (!restored.room.players.some(player => player.id === playerId)) {
    throw new Error("player is not a room member");
  }
  return createPlayerStateEnvelope(
    restored.room.id,
    playerId,
    werewolfPlayerGameView(restored.room, playerId),
  );
}
