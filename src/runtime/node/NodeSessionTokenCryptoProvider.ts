import crypto from "node:crypto";
import type { SessionTokenCryptoProvider } from "../../core/security/SessionTokenCryptoProvider.js";

export class NodeSessionTokenCryptoProvider implements SessionTokenCryptoProvider {
  randomToken(byteLength: number): string {
    return crypto.randomBytes(byteLength).toString("base64url");
  }

  async sha256Hex(value: string): Promise<string> {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
  }

  timingSafeEqualHex(actualHex: string, expectedHex: string): boolean {
    if (actualHex.length !== expectedHex.length) return false;
    const actual = Buffer.from(actualHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
}
