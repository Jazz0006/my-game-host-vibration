import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("E3.2 WeChat transport architecture boundary", () => {
  it("keeps shared ClientSession free of WeChat platform APIs", () => {
    const session = read("src/client/runtime/ClientSession.ts");
    const transport = read("src/client/runtime/ClientRealtimeTransport.ts");

    for (const source of [session, transport]) {
      expect(source).not.toMatch(/\bwx\./u);
      expect(source).not.toMatch(/connectSocket/u);
      expect(source).not.toMatch(/WeChatRealtimeTransport/u);
    }
  });

  it("keeps WeChat transport free of Werewolf rule/runtime imports", () => {
    const source = read("src/client/wechat/WeChatRealtimeTransport.ts");
    expect(source).not.toMatch(/games\/werewolf/u);
    expect(source).not.toMatch(/runtime\/shared\/werewolf/u);
    expect(source).not.toMatch(/WerewolfGameModule/u);
  });
});
