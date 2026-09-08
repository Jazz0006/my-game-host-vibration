import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("E3.2 effect durability boundary", () => {
  it("does not add an effect outbox to the native transport", () => {
    const source = fs.readFileSync(path.join(root, "src/client/wechat/WeChatRealtimeTransport.ts"), "utf8");
    expect(source).not.toContain("EffectOutbox");
    expect(source).not.toContain("eventReplay");
  });
});
