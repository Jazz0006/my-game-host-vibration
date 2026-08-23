import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOTS = ["src", "public", "dev", "tests", "scripts"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".css", ".html"]);
const EXCLUDED_DIRS = new Set(["node_modules", "client-runtime", "dist", "coverage"]);
const WARN_BYTES = 40_000;
const MAX_BYTES = 50_000;

const files = [];

function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    files.push({ path: relative(process.cwd(), fullPath), bytes: statSync(fullPath).size });
  }
}

for (const root of ROOTS) walk(root);
files.sort((left, right) => right.bytes - left.bytes);

const oversized = files.filter(file => file.bytes > MAX_BYTES);
const warnings = files.filter(file => file.bytes > WARN_BYTES && file.bytes <= MAX_BYTES);

for (const file of warnings) {
  console.warn(`WARNING ${file.path}: ${file.bytes} bytes (>${WARN_BYTES})`);
}
for (const file of oversized) {
  console.error(`ERROR ${file.path}: ${file.bytes} bytes (>${MAX_BYTES})`);
}

console.log(`Checked ${files.length} source files; largest: ${files[0]?.path ?? "n/a"} (${files[0]?.bytes ?? 0} bytes)`);
if (oversized.length) process.exit(1);
