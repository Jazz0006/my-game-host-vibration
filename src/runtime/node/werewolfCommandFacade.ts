import { RoomCommandRuntime } from "../../core/room/RoomCommandRuntime.js";
import type { WerewolfCommand } from "../../games/werewolf/WerewolfGameModule.js";
import {
  executeWerewolfCommand,
  type HostRecoveryCommandOutcome,
  type RuntimeCommandOutcome,
  type RuntimeRoom,
  type WerewolfCommandOutcome,
} from "./roomBridge.js";

const roomCommands = new RoomCommandRuntime<RuntimeCommandOutcome, RuntimeRoom>();

function playerCommandScope(playerId: string): string {
  return `player:${playerId}`;
}

const HOST_COMMAND_SCOPE = "host";

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

/**
 * C3/D1 transport-runtime mutation entry point. The game module never sees the
 * commandId; duplicate delivery is absorbed by the transport-neutral room
 * command runtime before domain mutation. Player command ids are scoped by the
 * stable playerId so two clients cannot collide.
 */
export function runPlayerCommandIdempotent(
  room: RuntimeRoom,
  playerId: string,
  commandId: string,
  command: WerewolfCommand,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  return roomCommands.execute(
    room,
    playerCommandScope(playerId),
    commandId,
    () => executeWerewolfCommand(room, command, { playerId }),
  );
}

export function runHostCommandIdempotent(
  room: RuntimeRoom,
  commandId: string,
  command: WerewolfCommand,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  return roomCommands.execute(
    room,
    HOST_COMMAND_SCOPE,
    commandId,
    () => executeWerewolfCommand(room, command, { isHost: true }),
  );
}

/**
 * C4 recovery entry point for host-triggered delivery effects that must be
 * retry-safe but must not enter WerewolfCommand or mutate game state.
 */
export function runHostRecoveryCommandIdempotent(
  room: RuntimeRoom,
  commandId: string,
  delivery: () => HostRecoveryCommandOutcome,
): Promise<{ outcome: HostRecoveryCommandOutcome; replayed: boolean }> {
  return roomCommands.execute(
    room,
    HOST_COMMAND_SCOPE,
    commandId,
    delivery,
  );
}

export function runHostLifecycleMutationIdempotent(
  room: RuntimeRoom,
  commandId: string,
  mutation: () => WerewolfCommandOutcome,
): Promise<{
  outcome: WerewolfCommandOutcome;
  replayed: boolean;
}> {
  return roomCommands.execute(
    room,
    HOST_COMMAND_SCOPE,
    commandId,
    mutation,
    { resetReceiptHistory: true },
  );
}
