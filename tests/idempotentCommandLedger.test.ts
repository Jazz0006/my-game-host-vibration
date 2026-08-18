import { describe, expect, it } from "vitest";
import { IdempotentCommandLedger } from "../src/core/command/IdempotentCommandLedger.js";

describe("C3 idempotent command ledger", () => {
  it("executes a mutation once and replays the original result for the same commandId", async () => {
    const ledger = new IdempotentCommandLedger<{ revision: number }>();
    let mutations = 0;

    const first = await ledger.execute("cmd-1", () => {
      mutations += 1;
      return { revision: mutations };
    });
    const retry = await ledger.execute("cmd-1", () => {
      mutations += 1;
      return { revision: mutations };
    });

    expect(first).toEqual({ result: { revision: 1 }, replayed: false });
    expect(retry).toEqual({ result: { revision: 1 }, replayed: true });
    expect(mutations).toBe(1);
  });

  it("shares one in-flight mutation when concurrent retries use the same commandId", async () => {
    const ledger = new IdempotentCommandLedger<{ revision: number }>();
    let mutations = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const firstPromise = ledger.execute("cmd-concurrent", async () => {
      mutations += 1;
      await gate;
      return { revision: mutations };
    });
    const retryPromise = ledger.execute("cmd-concurrent", async () => {
      mutations += 1;
      return { revision: mutations };
    });

    await Promise.resolve();
    expect(mutations).toBe(1);
    release();

    const [first, retry] = await Promise.all([firstPromise, retryPromise]);
    expect(first).toEqual({ result: { revision: 1 }, replayed: false });
    expect(retry).toEqual({ result: { revision: 1 }, replayed: true });
    expect(mutations).toBe(1);
  });

  it("does not remember a command when the mutation fails", async () => {
    const ledger = new IdempotentCommandLedger<string>();
    let attempts = 0;

    await expect(
      ledger.execute("cmd-fail", () => {
        attempts += 1;
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    expect(ledger.has("cmd-fail")).toBe(false);

    const retry = await ledger.execute("cmd-fail", () => {
      attempts += 1;
      return "ok";
    });

    expect(retry).toEqual({ result: "ok", replayed: false });
    expect(attempts).toBe(2);
  });

  it("releases a failed in-flight command so a later retry can execute", async () => {
    const ledger = new IdempotentCommandLedger<string>();
    let attempts = 0;
    let rejectFirst!: (error: Error) => void;
    const gate = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });

    const first = ledger.execute("cmd-race-fail", async () => {
      attempts += 1;
      return await gate;
    });
    const concurrentRetry = ledger.execute("cmd-race-fail", () => {
      attempts += 1;
      return "should-not-run";
    });

    await Promise.resolve();
    rejectFirst(new Error("network-adjacent failure"));
    await expect(first).rejects.toThrow("network-adjacent failure");
    await expect(concurrentRetry).rejects.toThrow("network-adjacent failure");
    expect(attempts).toBe(1);
    expect(ledger.has("cmd-race-fail")).toBe(false);

    const laterRetry = await ledger.execute("cmd-race-fail", () => {
      attempts += 1;
      return "ok";
    });
    expect(laterRetry).toEqual({ result: "ok", replayed: false });
    expect(attempts).toBe(2);
  });

  it("keeps only the most recent bounded receipts", async () => {
    const ledger = new IdempotentCommandLedger<number>(2);

    await ledger.execute("cmd-1", () => 1);
    await ledger.execute("cmd-2", () => 2);
    await ledger.execute("cmd-3", () => 3);

    expect(ledger.has("cmd-1")).toBe(false);
    expect(ledger.entries()).toEqual([
      { commandId: "cmd-2", result: 2 },
      { commandId: "cmd-3", result: 3 },
    ]);
  });

  it("restores bounded receipts so a retry after room recovery remains idempotent", async () => {
    const original = new IdempotentCommandLedger<{ changed: boolean }>(3);
    await original.execute("cmd-before-disconnect", () => ({ changed: true }));

    const restored = new IdempotentCommandLedger<{ changed: boolean }>(3);
    restored.restore(JSON.parse(JSON.stringify(original.entries())));

    let mutations = 0;
    const retry = await restored.execute("cmd-before-disconnect", () => {
      mutations += 1;
      return { changed: false };
    });

    expect(retry).toEqual({ result: { changed: true }, replayed: true });
    expect(mutations).toBe(0);
  });

  it("requires a non-empty commandId and a valid bound", async () => {
    expect(() => new IdempotentCommandLedger(0)).toThrow(/maxEntries/);
    const ledger = new IdempotentCommandLedger<string>();
    await expect(ledger.execute("   ", () => "nope")).rejects.toThrow(/commandId/);
  });
});
