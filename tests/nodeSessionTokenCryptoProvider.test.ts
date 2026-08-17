import { describe, expect, it } from "vitest";
import { NodeSessionTokenCryptoProvider } from "../src/runtime/node/NodeSessionTokenCryptoProvider.js";

describe("NodeSessionTokenCryptoProvider", () => {
  it("produces URL-safe random tokens and SHA-256 hex hashes", async () => {
    const provider = new NodeSessionTokenCryptoProvider();
    const first = provider.randomToken(32);
    const second = provider.randomToken(32);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);

    const hash = await provider.sha256Hex(first);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(provider.timingSafeEqualHex(hash, hash)).toBe(true);
  });

  it("rejects unequal hashes without throwing on different lengths", () => {
    const provider = new NodeSessionTokenCryptoProvider();

    expect(provider.timingSafeEqualHex("aa", "bb")).toBe(false);
    expect(provider.timingSafeEqualHex("aa", "bbbb")).toBe(false);
  });
});
