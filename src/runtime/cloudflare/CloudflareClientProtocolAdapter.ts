import type { WerewolfClientCommandEnvelope } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
import { mapWerewolfClientCommand } from "../../protocol/client/werewolf/WerewolfClientProtocol.js";
export {
  createGamePlayerStateEnvelope as createCloudflarePlayerStateEnvelope,
  createGameRoomStateEnvelope as createCloudflareRoomStateEnvelope,
} from "../shared/gameClientStateProjection.js";
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

