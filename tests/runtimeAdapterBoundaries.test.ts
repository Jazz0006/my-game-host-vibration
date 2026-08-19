import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

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
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  return [...source.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu,
  )].map(match => match[1]!);
}

function expectNoImports(relativeDirectory: string, forbidden: RegExp[]): void {
  for (const relativePath of typescriptFiles(relativeDirectory)) {
    for (const imported of importsOf(relativePath)) {
      for (const pattern of forbidden) {
        expect(
          pattern.test(imported),
          `${relativePath} must not import ${imported}`,
        ).toBe(false);
        pattern.lastIndex = 0;
      }
    }
  }
}

describe("runtime adapter boundaries", () => {
  it("keeps the shared runtime independent from platform transports", () => {
    expectNoImports("src/runtime/shared", [
      /^node:/u,
      /^socket\.io/u,
      /^express$/u,
      /(?:^|\/)runtime\/node(?:\/|$)/u,
      /(?:^|\/)runtime\/cloudflare(?:\/|$)/u,
    ]);
  });

  it("keeps the Cloudflare runtime independent from Node and Socket.IO", () => {
    expectNoImports("src/runtime/cloudflare", [
      /^node:/u,
      /^socket\.io/u,
      /^express$/u,
      /(?:^|\/)runtime\/node(?:\/|$)/u,
    ]);
  });
});
