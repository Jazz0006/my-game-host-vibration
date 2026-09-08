import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("E3.2 game expansion boundary", () => {
  it("does not introduce BotC game logic into the WeChat transport", () => {
    const source = fs.readFileSync(path.join(root, "src/client/wechat/WeChatRealtimeTransport.ts"), "utf8");
    expect(source).not.toMatch(/blood.?on.?the.?clocktower/iu);
    expect(source).not.toMatch(/\bbotc\b/iu);
  });
});
