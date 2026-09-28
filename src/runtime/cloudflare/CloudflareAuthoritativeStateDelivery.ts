import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  createClientRawWebSocketStateFrame,
  encodeClientRawWebSocketFrame,
} from "../../protocol/client/ClientRawWebSocketProtocol.js";
import {
  createCloudflarePlayerStateEnvelope,
  createCloudflareRoomStateEnvelope,
} from "./CloudflareClientProtocolAdapter.js";
import type { CloudflareRoomRealtime } from "./CloudflareRoomRealtime.js";

export type CloudflareClientSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  unknown
>;

export function pushCloudflareAuthoritativeStates(
  realtime: CloudflareRoomRealtime,
  snapshot: CloudflareClientSnapshot,
): void {
  for (const member of snapshot.membership) {
    try {
      const roomFrame = createClientRawWebSocketStateFrame(
        snapshot.revision,
        createCloudflareRoomStateEnvelope(snapshot, member.id),
      );
      const playerFrame = createClientRawWebSocketStateFrame(
        snapshot.revision,
        createCloudflarePlayerStateEnvelope(snapshot, member.id),
      );
      realtime.sendToPlayer(member.id, encodeClientRawWebSocketFrame(roomFrame));
      realtime.sendToPlayer(member.id, encodeClientRawWebSocketFrame(playerFrame));
    } catch {
      // Authoritative pushes remain recoverable through explicit sync.
    }
  }
}
