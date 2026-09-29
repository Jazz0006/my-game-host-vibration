import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WECHAT_PRODUCTS } from "./wechat-products.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireFile(productRoot, relativePath) {
  const absolute = path.join(productRoot, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing WeChat shell file: ${relativePath}`);
  }
  return absolute;
}

for (const product of WECHAT_PRODUCTS) {
  const productRoot = path.join(repoRoot, "wechat-build", product.id);
  const requiredFiles = [
    "project.config.json",
    "miniprogram/app.js",
    "miniprogram/app.json",
    "miniprogram/app.wxss",
    "miniprogram/sitemap.json",
    "miniprogram/product-config.js",
    "miniprogram/pages/index/index.js",
    "miniprogram/pages/index/index.json",
    "miniprogram/pages/index/index.wxml",
    "miniprogram/pages/index/index.wxss",
    "miniprogram/pages/lobby.js",
    "miniprogram/pages/lobby.wxml",
    "miniprogram/pages/settings.js",
    "miniprogram/pages/diagnostics.js",
    "miniprogram/README.md",
    "miniprogram/runtime/client/WeChatNativeClient.js",
    "miniprogram/runtime/client/WeChatMinimalPageController.js",
  ];

  for (const relativePath of requiredFiles) requireFile(productRoot, relativePath);

  const projectConfig = JSON.parse(
    fs.readFileSync(requireFile(productRoot, "project.config.json"), "utf8"),
  );
  if (projectConfig.miniprogramRoot !== "miniprogram/") {
    throw new Error(`${product.id} project must own its generated miniprogram root`);
  }

  const productConfig = fs.readFileSync(
    requireFile(productRoot, "miniprogram/product-config.js"),
    "utf8",
  );
  if (!productConfig.includes(`"gameType": "${product.gameType}"`)) {
    throw new Error(`${product.id} shell has incorrect fixed gameType`);
  }

  const runtimePackage = requireFile(productRoot, "miniprogram/runtime/package.json");
  const runtimeEntry = requireFile(
    productRoot,
    "miniprogram/runtime/client/WeChatNativeClient.js",
  );
  const runtimeSource = fs.readFileSync(runtimeEntry, "utf8");
  if (!runtimeSource.includes("module.exports") || /(^|\n)\s*import\s/u.test(runtimeSource)) {
    throw new Error(`${product.id} runtime entry must be emitted as CommonJS`);
  }

  const runtimeRequire = createRequire(runtimePackage);
  const nativeClient = runtimeRequire("./client/WeChatNativeClient.js");
  const pageController = runtimeRequire("./client/WeChatMinimalPageController.js");

  if (typeof nativeClient.createWeChatNativeClientFromGlobal !== "function") {
    throw new Error(`${product.id} native runtime entry is missing createWeChatNativeClientFromGlobal`);
  }
  if (typeof pageController.WeChatMinimalPageController !== "function") {
    throw new Error(`${product.id} runtime entry is missing WeChatMinimalPageController`);
  }
}

console.log("WeChat game-specific product shells verified.");
