import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

describe("platform boundaries", () => {
  it("keeps the Werewolf rules engine free of Node runtime imports", () => {
    const gameSource = source("src/domain/game.ts");

    expect(gameSource).not.toMatch(/from\s+["']node:/u);
    expect(gameSource).not.toMatch(/require\(["']node:/u);
  });

  it("keeps session-token crypto implementation out of the platform-neutral service", () => {
    const serviceSource = source("src/core/session/SessionTokenService.ts");

    expect(serviceSource).not.toMatch(/from\s+["']node:/u);
    expect(serviceSource).not.toMatch(/require\(["']node:/u);
  });
});
