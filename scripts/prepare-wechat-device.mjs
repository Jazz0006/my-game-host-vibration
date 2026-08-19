import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const source = join(root, "public", "client-runtime");
const target = join(root, "dev", "wechat-e3-device", "miniprogram", "client-runtime");

const required = [
  "client/wechat/WeChatMiniProgramBindings.js",
  "client/wechat/WeChatWerewolfVerticalSlice.js",
  "client/wechat/WeChatSessionLifecycle.js",
];

for (const relativePath of required) {
  const fullPath = join(source, relativePath);
  try {
    await access(fullPath);
  } catch {
    console.error(`Missing built runtime file: ${relativePath}`);
    if (relativePath.endsWith("WeChatSessionLifecycle.js")) {
      console.error(
        "E3.1 is still an independent branch. For the local device-validation branch, merge " +
          "origin/agent/e3-1-wechat-lifecycle-boundary, then rerun npm run prepare:wechat-device.",
      );
    }
    process.exit(1);
  }
}

await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

console.log(`Prepared WeChat device runtime at ${target}`);
console.log("Import dev/wechat-e3-device in WeChat DevTools.");
