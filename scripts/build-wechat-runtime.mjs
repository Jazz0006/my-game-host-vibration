import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(repoRoot, "miniprogram", "runtime", "client");

const entries = [
  ["src/client/WeChatNativeClient.ts", "WeChatNativeClient.js"],
  ["src/client/WeChatMinimalPageController.ts", "WeChatMinimalPageController.js"],
];

for (const [entry, outfile] of entries) {
  await build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    outfile: path.join(runtimeRoot, outfile),
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    sourcemap: false,
    minify: false,
    logLevel: "silent",
  });
}
