export interface GameRandomSource {
  randomInt(maxExclusive: number): number;
  randomId(): string;
}

function webCryptoRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new RangeError("maxExclusive must be a positive safe integer no greater than 2^32");
  }

  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  let value: number;
  do {
    globalThis.crypto.getRandomValues(values);
    value = values[0]!;
  } while (value >= limit);
  return value % maxExclusive;
}

export const defaultGameRandomSource: GameRandomSource = {
  randomInt: webCryptoRandomInt,
  randomId() {
    return globalThis.crypto.randomUUID();
  },
};
