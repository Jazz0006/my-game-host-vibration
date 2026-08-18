import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("C4.1 host recovery UI contract", () => {
  it("routes the Host recovery button through the retry-safe command helper", () => {
    const html = source("public/index.html");
    const app = source("public/app.js");

    expect(html).toContain('id="resend-current-action"');
    expect(html).toContain("emitCommandWithAck('host:resend-current-action', {})");
    expect(app).toContain("function emitCommandWithAck(event, payload, onSuccess, onFailure)");
  });
});
