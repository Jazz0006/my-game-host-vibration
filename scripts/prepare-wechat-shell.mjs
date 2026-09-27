import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(repoRoot, "miniprogram", "runtime");
const pageDir = path.join(repoRoot, "miniprogram", "pages", "index");

fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(pageDir, { recursive: true });
fs.writeFileSync(
  path.join(runtimeDir, "package.json"),
  '{\n  "type": "commonjs"\n}\n',
  "utf8",
);
