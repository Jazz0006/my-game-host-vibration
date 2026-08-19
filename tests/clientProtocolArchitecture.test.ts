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

function expectTransportNeutral(relativePath: string): void {
  for (const imported of importsOf(relativePath)) {
    expect(imported, `${relativePath} must stay transport-neutral`).not.toMatch(/^node:/u);
    expect(imported, `${relativePath} must stay transport-neutral`).not.toMatch(/^socket\.io/u);
    expect(imported, `${relativePath} must stay transport-neutral`).not.toMatch(
      /(?:^|\/)runtime(?:\/|$)/u,
    );
    expect(imported, `${relativePath} must stay transport-neutral`).not.toMatch(/cloudflare/iu);
  }
}

describe("E1 client protocol architecture", () => {
  it("keeps concrete game modules independent from client protocol", () => {
    for (const file of typescriptFiles("src/games")) {
      for (const imported of importsOf(file)) {
        expect(imported, `${file} must not import client protocol`).not.toMatch(
          /(?:^|\/)protocol(?:\/|$)/u,
        );
      }
    }
  });

  it("keeps the generic client protocol free of runtime and transport dependencies", () => {
    expectTransportNeutral("src/protocol/client/ClientProtocol.ts");
  });

  it("keeps session lifecycle event contracts transport-neutral", () => {
    expectTransportNeutral("src/protocol/client/ClientSessionEvents.ts");
  });

  it("keeps Node and Cloudflare client protocol adapters separated", () => {
    for (const imported of importsOf("src/runtime/node/NodeClientProtocolAdapter.ts")) {
      expect(imported).not.toMatch(/(?:^|\/)cloudflare(?:\/|$)/u);
    }
    for (const imported of importsOf("src/runtime/cloudflare/CloudflareClientProtocolAdapter.ts")) {
      expect(imported).not.toMatch(/(?:^|\/)node(?:\/|$)/u);
    }
  });
});
