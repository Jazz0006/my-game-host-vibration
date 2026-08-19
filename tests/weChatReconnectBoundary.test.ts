import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("E3.3 reconnect architecture boundary", () => {
  it("keeps reconnect state authority in shared ClientSession/store instead of the WeChat composition root", () => {
    const composition = read("src/client/wechat/WeChatClientSession.ts");
    expect(composition).not.toMatch(/revision\s*[+\-=]/u);
    expect(composition).not.toMatch(/phase\s*=/u);
    expect(composition).not.toMatch(/client:event/u);
  });
});
