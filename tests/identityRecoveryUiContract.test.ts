import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public/recoveryIdentity.js"), "utf8");
const snapshot = fs.readFileSync(path.join(root, "src/core/room/RoomSnapshot.ts"), "utf8");

describe("C4.3 identity recovery UI contract", () => {
  it("provides separate host grant and unauthenticated claim entry points", () => {
    expect(html).toContain("data-open-identity-recovery");
    expect(html).toContain('id="claim-identity-recovery"');
    expect(html).toContain('<script src="/recoveryIdentity.js"></script>');
    expect(script).toContain('"host:create-identity-recovery"');
    expect(script).toContain('"player:claim-identity-recovery"');
    expect(script).toContain("saveSession(result)");
    expect(script).toContain("activateClientSession(result)");
  });

  it("does not add transient recovery grants or plaintext credentials to RoomSnapshot", () => {
    expect(snapshot).not.toContain("recoveryCode");
    expect(snapshot).not.toContain("recoveryGrant");
    expect(snapshot).not.toContain("resumeToken:");
    expect(snapshot).toContain('"resumeTokenHash"');
  });
});
