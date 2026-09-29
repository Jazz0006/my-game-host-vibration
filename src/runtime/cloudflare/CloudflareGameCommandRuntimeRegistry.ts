import type { RoomSnapshot } from "../../core/room/RoomSnapshot.js";
import type { GameType } from "../../games/GameCatalog.js";
import type { ClientCommandEnvelope } from "../../protocol/client/ClientProtocol.js";
import type { CloudflareRoomRealtime, HibernationWebSocketLike } from "./CloudflareRoomRealtime.js";
import type { DurableObjectStorageLike } from "./CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfGameCommandHandler } from "./CloudflareWerewolfGameCommandHandler.js";

export type CloudflareGameCommandHandler = {
  handleSync(playerId: string, snapshot: RoomSnapshot): Promise<void>;
  handleCommand(
    webSocket: HibernationWebSocketLike,
    playerId: string,
    requestId: string,
    envelope: ClientCommandEnvelope,
  ): Promise<void>;
  clearRoomRuntimeState(): Promise<void>;
};

/**
 * Cloudflare runtime dispatch seam. Shared Raw WebSocket code selects one
 * adapter by the room's immutable gameType and never imports concrete game
 * commands, interactions, lifecycle protocols, or side-effect policies.
 */
export function createCloudflareGameCommandHandler(
  gameType: GameType,
  storage: DurableObjectStorageLike,
  realtime: CloudflareRoomRealtime,
): CloudflareGameCommandHandler | undefined {
  switch (gameType) {
    case "werewolf":
      return new CloudflareWerewolfGameCommandHandler(storage, realtime);
    case "botc":
      return undefined;
  }
}
