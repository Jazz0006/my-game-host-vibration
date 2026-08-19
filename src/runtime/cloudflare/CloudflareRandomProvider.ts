import type { RandomProvider } from "../../core/random/RandomProvider.js";

const UINT32_RANGE = 0x1_0000_0000;

/** Web Crypto RandomProvider for the Cloudflare runtime. */
export class CloudflareRandomProvider implements RandomProvider {
  randomInt(maxExclusive: number): number {
    if (
      !Number.isSafeInteger(maxExclusive) ||
      maxExclusive <= 0 ||
      maxExclusive > UINT32_RANGE
    ) {
      throw new Error("maxExclusive must be an integer between 1 and 2^32");
    }

    // Rejection sampling avoids modulo bias while keeping the runtime free of
    // Node crypto dependencies.
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
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
