import crypto from "node:crypto";

const TOKEN_BYTES = 32;

export type SessionToken = {
  token: string;
  hash: string;
};

export function createSessionToken(): SessionToken {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifySessionToken(token: string, expectedHash: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/u.test(expectedHash)) return false;

  const actual = Buffer.from(hashSessionToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
