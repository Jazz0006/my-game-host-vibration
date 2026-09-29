import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { WECHAT_PRODUCTS } from "./wechat-products.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const entries = [
  ["src/client/WeChatNativeClient.ts", "WeChatNativeClient.js"],
  ["src/client/WeChatMinimalPageController.ts", "WeChatMinimalPageController.js"],
];

for (const product of WECHAT_PRODUCTS) {
  const runtimeRoot = path.join(
    repoRoot,
    "wechat-build",
    product.id,
    "miniprogram",
    "runtime",
    "client",
  );

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
}
