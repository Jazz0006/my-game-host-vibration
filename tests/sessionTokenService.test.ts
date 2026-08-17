import { describe, expect, it } from "vitest";
import type { SessionTokenCryptoProvider } from "../src/core/security/SessionTokenCryptoProvider.js";
import { SessionTokenService } from "../src/core/session/SessionTokenService.js";

class FakeSessionTokenCryptoProvider implements SessionTokenCryptoProvider {
  private counter = 0;

  randomToken(byteLength: number): string {
    this.counter += 1;
    return `token-${byteLength}-${this.counter}`;
  }

  async sha256Hex(value: string): Promise<string> {
    const seed = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0)
      .toString(16)
      .padStart(2, "0")
      .slice(-2);
    return seed.repeat(32);
  }

  timingSafeEqualHex(actualHex: string, expectedHex: string): boolean {
    return actualHex === expectedHex;
  }
}

describe("SessionTokenService", () => {
  it("creates tokens through the injected crypto provider", async () => {
    const service = new SessionTokenService(new FakeSessionTokenCryptoProvider());

    const first = await service.createSessionToken();
    const second = await service.createSessionToken();

    expect(first.token).toBe("token-32-1");
    expect(second.token).toBe("token-32-2");
    expect(first.hash).toHaveLength(64);
    expect(first.hash).toBe(await service.hashSessionToken(first.token));
  });

  it("verifies valid hashes and rejects malformed inputs without platform dependencies", async () => {
    const service = new SessionTokenService(new FakeSessionTokenCryptoProvider());
    const session = await service.createSessionToken();

    expect(await service.verifySessionToken(session.token, session.hash)).toBe(true);
    expect(await service.verifySessionToken("wrong-token", session.hash)).toBe(false);
    expect(await service.verifySessionToken(session.token, "not-a-hash")).toBe(false);
    expect(await service.verifySessionToken("", session.hash)).toBe(false);
  });
});
