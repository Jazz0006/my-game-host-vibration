import {
  actingPlayerIds,
  type RuntimePlayer,
  type RuntimeRoom,
} from "./roomBridge.js";

/**
 * C4 recovery projection for reminder re-delivery. It exposes only stable actor
 * membership plus current Node connection routing; it does not expose roles,
 * submitted secret answers, or mutate the active interaction.
 */
export function onlineActingPlayers(room: RuntimeRoom): RuntimePlayer[] {
  const actorIds = new Set(actingPlayerIds(room));
  return room.players.filter(
    player => actorIds.has(player.id) && player.connected && Boolean(player.socketId),
  );
}
