import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("E3.2 injectable WeChat platform seam", () => {
  it("does not require a global wx object in the transport implementation", () => {
    const source = fs.readFileSync(path.join(root, "src/client/wechat/WeChatRealtimeTransport.ts"), "utf8");
    expect(source).not.toMatch(/\bglobalThis\.wx\b/u);
    expect(source).not.toMatch(/\bwx\./u);
  });
});
