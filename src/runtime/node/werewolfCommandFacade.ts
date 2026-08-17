import type { WerewolfCommand } from "../../games/werewolf/WerewolfGameModule.js";
import {
  executeWerewolfCommand,
  type RuntimeRoom,
  type WerewolfCommandOutcome,
} from "./roomBridge.js";

// Stable Node-runtime entry points: transport handlers provide identity/authority,
// while WerewolfGameModule owns rule-specific command handling and projections.
export function runPlayerCommand(
  room: RuntimeRoom,
  playerId: string,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { playerId });
}

export function runHostCommand(
  room: RuntimeRoom,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { isHost: true });
}
