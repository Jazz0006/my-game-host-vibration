import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("project baseline", () => {
  it("contains the server and browser entry points", () => {
    expect(fs.existsSync(path.join(projectRoot, "src/server.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "public/index.html"))).toBe(true);
  });

  it("declares an ESM TypeScript project", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as { type?: string; scripts?: Record<string, string> };

    expect(packageJson.type).toBe("module");
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
  });
});
