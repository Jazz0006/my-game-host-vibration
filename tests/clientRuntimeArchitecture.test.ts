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

function typescriptFiles(relativeDirectory: string): string[] {
  const directory = path.join(repoRoot, relativeDirectory);
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) results.push(...typescriptFiles(relativePath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(relativePath);
  }
  return results;
}

function importsOf(relativePath: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of source(relativePath).matchAll(pattern)) imports.push(match[1]!);
  return imports;
}

describe("E2.2a client runtime architecture", () => {
  it("keeps game modules independent from the client runtime", () => {
    for (const file of typescriptFiles("src/games")) {
      for (const imported of importsOf(file)) {
        expect(imported, `${file} must not import client runtime`).not.toMatch(
          /(?:^|\/)client(?:\/|$)/u,
        );
      }
    }
  });

  it("keeps client runtime transport-neutral and game-neutral", () => {
    for (const file of typescriptFiles("src/client/runtime")) {
      for (const imported of importsOf(file)) {
        expect(imported, `${file} must not import Node built-ins`).not.toMatch(/^node:/u);
        expect(imported, `${file} must not import Socket.IO`).not.toMatch(/^socket\.io/u);
        expect(imported, `${file} must not import server runtimes`).not.toMatch(
          /(?:^|\/)runtime(?:\/|$)/u,
        );
        expect(imported, `${file} must not import Cloudflare`).not.toMatch(/cloudflare/iu);
        expect(imported, `${file} must not import Werewolf rules`).not.toMatch(
          /(?:^|\/)games(?:\/|$)/u,
        );
      }

      const contents = source(file);
      expect(contents, `${file} must not reference browser DOM globals`).not.toMatch(
        /\b(?:document|window)\b/u,
      );
      expect(contents, `${file} must not reference WeChat globals`).not.toMatch(/\bwx\b/u);
    }
  });
});
