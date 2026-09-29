import { RoomCommandRuntime } from "../../core/room/RoomCommandRuntime.js";
import type { WerewolfCommand } from "../../games/werewolf/WerewolfGameModule.js";
import type { RoomRecoveryCommand } from "../../protocol/client/ClientRecoveryProtocol.js";
import {
  assertRoomRecoveryAuthority,
  executeRoomRecoveryCommand,
  type RoomRecoveryCommandOutcome,
  type RoomRecoveryDependencies,
} from "../shared/roomRecoveryCommand.js";
import type { WerewolfCommandEnvironment } from "../shared/werewolfRoomCommand.js";
import {
  executeWerewolfCommand,
  type RuntimeCommandOutcome,
  type RuntimeRoom,
  type WerewolfCommandOutcome,
} from "./roomBridge.js";

const roomCommands = new RoomCommandRuntime<RuntimeCommandOutcome, RuntimeRoom>();

function playerCommandScope(playerId: string): string {
  return `player:${playerId}`;
}

const MODERATOR_COMMAND_SCOPE = "game-moderator";
const OWNER_COMMAND_SCOPE = "room-owner";

// Stable Node-runtime entry points: transport handlers provide identity/authority,
// while WerewolfGameModule owns rule-specific command handling and projections.
export function runPlayerCommand(
  room: RuntimeRoom,
  playerId: string,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { playerId });
}

export function runModeratorCommand(
  room: RuntimeRoom,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { isModerator: true });
}

/**
 * C3/D1 transport-runtime mutation entry point. The game module never sees the
 * commandId; duplicate delivery is absorbed by the transport-neutral room
 * command runtime before domain mutation. Player command ids are scoped by the
 * stable playerId so two clients cannot collide.
 *
 * The optional environment is the D5 parity seam. Production Node callers omit
 * it and use Node crypto/clock defaults; parity tests can inject the same
 * deterministic dependencies used by the Cloudflare adapter.
 */
export function runPlayerCommandIdempotent(
  room: RuntimeRoom,
  playerId: string,
  commandId: string,
  command: WerewolfCommand,
  environment?: WerewolfCommandEnvironment,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  return roomCommands.execute(
    room,
    playerCommandScope(playerId),
    commandId,
    () => executeWerewolfCommand(room, command, { playerId }, environment),
  );
}

export function runModeratorCommandIdempotent(
  room: RuntimeRoom,
  commandId: string,
  command: WerewolfCommand,
  environment?: WerewolfCommandEnvironment,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  return roomCommands.execute(
    room,
    MODERATOR_COMMAND_SCOPE,
    commandId,
    () => executeWerewolfCommand(room, command, { isModerator: true }, environment),
  );
}

/**
 * W3D1 recovery entry point. Recovery semantics are owned by runtime/shared;
 * Node keeps only retry scoping and capability dependencies here.
 */
export function runHostRecoveryCommandIdempotent(
  room: RuntimeRoom,
  authenticatedPlayerId: string,
  commandId: string,
  command: RoomRecoveryCommand,
  dependencies: RoomRecoveryDependencies,
): Promise<{ outcome: RoomRecoveryCommandOutcome; replayed: boolean }> {
  // Re-check authority before receipt replay for the same reason as Cloudflare:
  // commandId dedupe must never become an authorization bypass.
  assertRoomRecoveryAuthority(room, authenticatedPlayerId, command);
  return roomCommands.execute(
    room,
    OWNER_COMMAND_SCOPE,
    commandId,
    () =>
      executeRoomRecoveryCommand(
        room,
        authenticatedPlayerId,
        command,
        dependencies,
      ),
    command.type === "recovery.abortToLobby"
      ? { resetReceiptHistory: true }
      : undefined,
  );
}

export function runModeratorLifecycleMutationIdempotent(
  room: RuntimeRoom,
  commandId: string,
  mutation: () => WerewolfCommandOutcome,
): Promise<{
  outcome: WerewolfCommandOutcome;
  replayed: boolean;
}> {
  return roomCommands.execute(
    room,
    MODERATOR_COMMAND_SCOPE,
    commandId,
    mutation,
    { resetReceiptHistory: true },
  );
}
