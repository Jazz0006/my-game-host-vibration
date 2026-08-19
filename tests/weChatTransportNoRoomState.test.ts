import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("E3.2 WeChat room state boundary", () => {
  it("does not copy the Web room:state Socket.IO contract into the native transport", () => {
    const source = fs.readFileSync(
      path.join(root, "src/client/wechat/WeChatRealtimeTransport.ts"),
      "utf8",
    );
    expect(source).not.toContain("room:state");
    expect(source).not.toContain("socket.io");
  });
});
