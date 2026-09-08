import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("E3.2 retry boundary", () => {
  it("does not add transport command retry before E3.4", () => {
    const source = fs.readFileSync(path.join(root, "src/client/wechat/WeChatRealtimeTransport.ts"), "utf8");
    expect(source).not.toContain("commandRetries");
    expect(source).not.toContain("emitAckWithRetry");
  });
});
