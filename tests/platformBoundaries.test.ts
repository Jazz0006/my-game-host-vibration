import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectNoNodeRuntimeImports(relativePath: string): void {
  const contents = source(relativePath);
  expect(contents).not.toMatch(/from\s+["']node:/u);
  expect(contents).not.toMatch(/require\(["']node:/u);
}

describe("platform boundaries", () => {
  it("keeps the Werewolf rules engine and default randomness free of Node runtime imports", () => {
    expectNoNodeRuntimeImports("src/domain/game.ts");
    expectNoNodeRuntimeImports("src/domain/gameRandom.ts");
  });

  it("keeps session-token contracts and service platform-neutral", () => {
    expectNoNodeRuntimeImports("src/core/security/SessionTokenCryptoProvider.ts");
    expectNoNodeRuntimeImports("src/core/session/SessionTokenService.ts");
  });

  it("removes the legacy domain session-token implementation", () => {
    expect(fs.existsSync(path.join(repoRoot, "src/domain/sessionToken.ts"))).toBe(false);
  });

  it("routes Node server session tokens through the service and runtime adapter", () => {
    const serverSource = source("src/server.ts");

    expect(serverSource).toContain('from "./core/session/SessionTokenService.js"');
    expect(serverSource).toContain('from "./runtime/node/NodeSessionTokenCryptoProvider.js"');
    expect(serverSource).not.toContain("./domain/sessionToken.js");
  });
});
