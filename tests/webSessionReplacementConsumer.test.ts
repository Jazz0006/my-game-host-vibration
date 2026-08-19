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

describe("E2.3d3a Web session replacement consumer", () => {
  it("cleans up the synchronized client session when ownership moves to another device", () => {
    const web = source("public/app.js");

    expect(web).toContain("unsubscribeClientRealtimeEvents?.()");
    expect(web).toContain("sessionReplaced = true");
    expect(web).toContain("membershipActive = false");
    expect(web).toContain("clearSession()");
    expect(web).toContain("teardownClientSession()");
    expect(web).toContain('setConnectionStatus("身份已在另一台设备恢复", "replaced")');
  });

  it("ignores replacement events that do not belong to the active identity", () => {
    const web = source("public/app.js");

    expect(web).toContain("event.payload?.roomId !== currentRoomId");
    expect(web).toContain("event.payload?.playerId !== currentPlayerId");
  });
});
