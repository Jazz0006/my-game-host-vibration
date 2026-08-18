export type CommandReceipt<TResult> = {
  commandId: string;
  result: TResult;
};

/**
 * Bounded in-memory dedupe ledger for mutation commands.
 *
 * The caller owns persistence/snapshotting. This core type guarantees that a
 * repeated commandId returns the original result without re-running the
 * mutation while the receipt remains inside the bounded window. Concurrent
 * retries also share the same in-flight mutation.
 */
export class IdempotentCommandLedger<TResult> {
  private readonly receipts = new Map<string, TResult>();
  private readonly inFlight = new Map<string, Promise<TResult>>();

  constructor(private readonly maxEntries = 128) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer");
    }
  }

  get(commandId: string): TResult | undefined {
    return this.receipts.get(commandId);
  }

  has(commandId: string): boolean {
    return this.receipts.has(commandId);
  }

  remember(commandId: string, result: TResult): void {
    const id = commandId.trim();
    if (!id) throw new Error("commandId is required");

    if (this.receipts.has(id)) {
      this.receipts.set(id, result);
      return;
    }

    this.receipts.set(id, result);
    while (this.receipts.size > this.maxEntries) {
      const oldest = this.receipts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.receipts.delete(oldest);
    }
  }

  entries(): CommandReceipt<TResult>[] {
    return Array.from(this.receipts, ([commandId, result]) => ({ commandId, result }));
  }

  restore(receipts: readonly CommandReceipt<TResult>[]): void {
    if (this.inFlight.size > 0) {
      throw new Error("cannot restore command receipts while mutations are in flight");
    }
    this.receipts.clear();
    for (const receipt of receipts.slice(-this.maxEntries)) {
      this.remember(receipt.commandId, receipt.result);
    }
  }

  async execute(
    commandId: string,
    mutation: () => TResult | Promise<TResult>,
  ): Promise<{ result: TResult; replayed: boolean }> {
    const id = commandId.trim();
    if (!id) throw new Error("commandId is required");

    if (this.receipts.has(id)) {
      return { result: this.receipts.get(id)!, replayed: true };
    }

    const existing = this.inFlight.get(id);
    if (existing) {
      return { result: await existing, replayed: true };
    }

    const pending = Promise.resolve().then(mutation);
    this.inFlight.set(id, pending);
    try {
      const result = await pending;
      this.remember(id, result);
      return { result, replayed: false };
    } finally {
      if (this.inFlight.get(id) === pending) this.inFlight.delete(id);
    }
  }
}
