import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashSessionToken,
  verifySessionToken,
} from "../src/domain/sessionToken.js";

describe("session token", () => {
  it("creates a random token and stores only its hash", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(hashSessionToken(first.token));
    expect(first.hash).not.toContain(first.token);
    expect(verifySessionToken(first.token, first.hash)).toBe(true);
  });

  it("rejects invalid tokens and malformed hashes", () => {
    const session = createSessionToken();

    expect(verifySessionToken("wrong-token", session.hash)).toBe(false);
    expect(verifySessionToken(session.token, "not-a-hash")).toBe(false);
  });
});
