import { IdempotentCommandLedger } from "../../core/command/IdempotentCommandLedger.js";
import type { WerewolfCommand } from "../../games/werewolf/WerewolfGameModule.js";
import {
  executeWerewolfCommand,
  type RuntimeRoom,
  type WerewolfCommandOutcome,
} from "./roomBridge.js";

const COMMAND_RECEIPT_LIMIT = 128;
const roomLedgers = new WeakMap<RuntimeRoom, IdempotentCommandLedger<WerewolfCommandOutcome>>();

function commandLedger(room: RuntimeRoom): IdempotentCommandLedger<WerewolfCommandOutcome> {
  const existing = roomLedgers.get(room);
  if (existing) return existing;

  const ledger = new IdempotentCommandLedger<WerewolfCommandOutcome>(COMMAND_RECEIPT_LIMIT);
  ledger.restore(room.commandReceipts ?? []);
  roomLedgers.set(room, ledger);
  return ledger;
}

function playerCommandKey(playerId: string, commandId: string): string {
  return `player:${playerId}:${commandId}`;
}

function hostCommandKey(commandId: string): string {
  return `host:${commandId}`;
}

async function runIdempotent(
  room: RuntimeRoom,
  scopedCommandId: string,
  mutation: () => WerewolfCommandOutcome,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  const ledger = commandLedger(room);
  const execution = await ledger.execute(scopedCommandId, mutation);
  room.commandReceipts = ledger.entries();
  return { outcome: execution.result, replayed: execution.replayed };
}

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
 * C3 transport/runtime mutation entry point. The game module never sees the
 * commandId; duplicate network delivery is absorbed before domain mutation.
 * Player command ids are scoped by stable playerId so two clients cannot collide.
 */
export function runPlayerCommandIdempotent(
  room: RuntimeRoom,
  playerId: string,
  commandId: string,
  command: WerewolfCommand,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  return runIdempotent(room, playerCommandKey(playerId, commandId), () =>
    executeWerewolfCommand(room, command, { playerId }));
}

export function runHostCommandIdempotent(
  room: RuntimeRoom,
  commandId: string,
  command: WerewolfCommand,
): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {
  return runIdempotent(room, hostCommandKey(commandId), () =>
    executeWerewolfCommand(room, command, { isHost: true }));
}
