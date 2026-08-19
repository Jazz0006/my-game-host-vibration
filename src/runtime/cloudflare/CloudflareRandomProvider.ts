import type { RandomProvider } from "../../core/random/RandomProvider.js";

/** Web Crypto RandomProvider for the Cloudflare runtime. */
export class CloudflareRandomProvider implements RandomProvider {
  randomInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("maxExclusive must be a positive safe integer");
    }

    // Rejection sampling avoids modulo bias while keeping the runtime free of
    // Node crypto dependencies.
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / maxExclusive) * maxExclusive;
    const value = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(value);
    } while (value[0]! >= limit);
    return value[0]! % maxExclusive;
  }

  randomId(): string {
    return globalThis.crypto.randomUUID();
  }
}
