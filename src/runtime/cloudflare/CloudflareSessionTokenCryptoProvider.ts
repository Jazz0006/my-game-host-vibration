import type { SessionTokenCryptoProvider } from "../../core/security/SessionTokenCryptoProvider.js";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Cloudflare/Web Crypto implementation of the C1 session-token contract. */
export class CloudflareSessionTokenCryptoProvider implements SessionTokenCryptoProvider {
  randomToken(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  async sha256Hex(value: string): Promise<string> {
    const encoded = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return bufferToHex(digest);
  }

  timingSafeEqualHex(actualHex: string, expectedHex: string): boolean {
    if (actualHex.length !== expectedHex.length) return false;

    let difference = 0;
    for (let index = 0; index < actualHex.length; index += 1) {
      difference |= actualHex.charCodeAt(index) ^ expectedHex.charCodeAt(index);
    }
    return difference === 0;
  }
}
