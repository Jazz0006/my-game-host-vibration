export interface SessionTokenCryptoProvider {
  randomToken(byteLength: number): string;
  sha256Hex(value: string): Promise<string>;
  timingSafeEqualHex(actualHex: string, expectedHex: string): boolean;
}
