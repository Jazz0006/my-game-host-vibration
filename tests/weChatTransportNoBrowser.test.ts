import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("E3.2 native platform boundary", () => {
  it("does not depend on browser DOM or Socket.IO", () => {
    const source = fs.readFileSync(path.join(root, "src/client/wechat/WeChatRealtimeTransport.ts"), "utf8");
    expect(source).not.toMatch(/\bdocument\b/u);
    expect(source).not.toMatch(/\bwindow\b/u);
    expect(source).not.toContain("socket.io");
  });
});
