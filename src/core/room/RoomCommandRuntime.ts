import {
  IdempotentCommandLedger,
  type CommandReceipt,
} from "../command/IdempotentCommandLedger.js";

export type RoomCommandReceiptState<TResult> = {
  commandReceipts?: CommandReceipt<TResult>[];
};

export type RoomCommandExecution<TResult> = {
  outcome: TResult;
  replayed: boolean;
};

export type RoomCommandExecutionOptions = {
  resetReceiptHistory?: boolean;
};

/**
 * Transport-neutral room mutation boundary.
 *
 * The caller owns actor authorization and chooses a stable command scope such
 * as `player:<stablePlayerId>` or `host`. Game/domain commands never receive
 * commandId. The runtime owns retry dedupe and persists its bounded receipts
 * back onto the authoritative room state so a later adapter can restore them.
 */
export class RoomCommandRuntime<
  TResult,
  TRoom extends object & RoomCommandReceiptState<TResult> = RoomCommandReceiptState<TResult> & object,
> {
  private readonly roomLedgers = new WeakMap<TRoom, IdempotentCommandLedger<TResult>>();

  constructor(private readonly receiptLimit = 128) {
    if (!Number.isSafeInteger(receiptLimit) || receiptLimit < 1) {
      throw new Error("receiptLimit must be a positive safe integer");
    }
  }

  async execute<TOutcome extends TResult>(
    room: TRoom,
    scope: string,
    commandId: string,
    mutation: () => TOutcome | Promise<TOutcome>,
    options: RoomCommandExecutionOptions = {},
  ): Promise<RoomCommandExecution<TOutcome>> {
    const scopedCommandId = this.scopedCommandId(scope, commandId);
    const ledger = this.commandLedger(room);
    const execution = await ledger.execute(scopedCommandId, mutation);

    if (!execution.replayed && options.resetReceiptHistory) {
      ledger.restore([
        {
          commandId: scopedCommandId,
          result: execution.result,
        },
      ]);
    }

    room.commandReceipts = ledger.entries();
    return {
      outcome: execution.result as TOutcome,
      replayed: execution.replayed,
    };
  }

  scopedCommandId(scope: string, commandId: string): string {
    const normalizedScope = scope.trim();
    const normalizedCommandId = commandId.trim();
    if (!normalizedScope) throw new Error("command scope is required");
    if (!normalizedCommandId) throw new Error("commandId is required");
    return `${normalizedScope}:${normalizedCommandId}`;
  }

  private commandLedger(room: TRoom): IdempotentCommandLedger<TResult> {
    const existing = this.roomLedgers.get(room);
    if (existing) return existing;

    const ledger = new IdempotentCommandLedger<TResult>(this.receiptLimit);
    ledger.restore(room.commandReceipts ?? []);
    this.roomLedgers.set(room, ledger);
    return ledger;
  }
}
