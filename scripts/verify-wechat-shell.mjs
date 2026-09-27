import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireFile(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing WeChat shell file: ${relativePath}`);
  }
  return absolute;
}

const requiredFiles = [
  "project.config.json",
  "miniprogram/app.js",
  "miniprogram/app.json",
  "miniprogram/app.wxss",
  "miniprogram/sitemap.json",
  "miniprogram/pages/index/index.js",
  "miniprogram/pages/index/index.json",
  "miniprogram/pages/index/index.wxml",
  "miniprogram/pages/index/index.wxss",
  "miniprogram/README.md",
  "miniprogram/runtime/client/WeChatNativeClient.js",
  "miniprogram/runtime/client/WeChatMinimalPageController.js",
];

for (const relativePath of requiredFiles) requireFile(relativePath);

const runtimePackage = requireFile("miniprogram/runtime/package.json");
const runtimeEntry = requireFile("miniprogram/runtime/client/WeChatNativeClient.js");
const runtimeSource = fs.readFileSync(runtimeEntry, "utf8");
if (!runtimeSource.includes("module.exports") || /(^|\n)\s*import\s/u.test(runtimeSource)) {
  throw new Error("WeChat runtime entry must be emitted as CommonJS");
}

const runtimeRequire = createRequire(runtimePackage);
const nativeClient = runtimeRequire("./client/WeChatNativeClient.js");
const pageController = runtimeRequire("./client/WeChatMinimalPageController.js");

if (typeof nativeClient.createWeChatNativeClientFromGlobal !== "function") {
  throw new Error("WeChat native runtime entry is missing createWeChatNativeClientFromGlobal");
}
if (typeof pageController.WeChatMinimalPageController !== "function") {
  throw new Error("WeChat runtime entry is missing WeChatMinimalPageController");
}

console.log("WeChat Developer Tools shell verified.");
