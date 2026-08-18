import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("C4.2 recovery diagnostics UI contract", () => {
  it("loads a dedicated Host recovery status renderer", () => {
    const html = source("public/index.html");
    expect(html).toContain('id="host-recovery-status"');
    expect(html).toContain('<script src="/recoveryStatus.js"></script>');
  });

  it("renders aggregate recovery counts without actor identity fields", () => {
    const ui = source("public/recoveryStatus.js");
    expect(ui).toContain("waitingCount");
    expect(ui).toContain("onlineWaitingCount");
    expect(ui).toContain("offlineWaitingCount");
    expect(ui).not.toContain("actorPlayerIds");
    expect(ui).not.toContain("roleName");
    expect(ui).not.toContain("targetPlayerId");
  });
});
