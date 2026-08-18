import type { SessionTokenCryptoProvider } from "../security/SessionTokenCryptoProvider.js";

const TOKEN_BYTES = 32;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export type SessionToken = {
  token: string;
  hash: string;
};

export class SessionTokenService {
  constructor(private readonly crypto: SessionTokenCryptoProvider) {}

  async createSessionToken(byteLength = TOKEN_BYTES): Promise<SessionToken> {
    if (!Number.isSafeInteger(byteLength) || byteLength < 8 || byteLength > TOKEN_BYTES) {
      throw new Error("session token byte length must be between 8 and 32");
    }
    const token = this.crypto.randomToken(byteLength);
    return { token, hash: await this.hashSessionToken(token) };
  }

  hashSessionToken(token: string): Promise<string> {
    return this.crypto.sha256Hex(token);
  }

  async verifySessionToken(token: string, expectedHash: string): Promise<boolean> {
    if (!token || !SHA256_HEX_PATTERN.test(expectedHash)) return false;
    const actualHash = await this.hashSessionToken(token);
    return this.crypto.timingSafeEqualHex(actualHash, expectedHash);
  }
}
