import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WECHAT_PRODUCTS } from "./wechat-products.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "miniprogram");
const outputRoot = path.join(repoRoot, "wechat-build");

fs.rmSync(outputRoot, { recursive: true, force: true });

function copySharedShell(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: current => {
      const relative = path.relative(sourceRoot, current);
      return relative !== "runtime" && !relative.startsWith(`runtime${path.sep}`);
    },
  });
}

for (const product of WECHAT_PRODUCTS) {
  const productRoot = path.join(outputRoot, product.id);
  const miniprogramRoot = path.join(productRoot, "miniprogram");
  const runtimeDir = path.join(miniprogramRoot, "runtime");

  fs.mkdirSync(productRoot, { recursive: true });
  copySharedShell(sourceRoot, miniprogramRoot);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "package.json"),
    '{\n  "type": "commonjs"\n}\n',
    "utf8",
  );

  fs.writeFileSync(
    path.join(miniprogramRoot, "product-config.js"),
    `module.exports = ${JSON.stringify(product, null, 2)};\n`,
    "utf8",
  );

  const appJsonPath = path.join(miniprogramRoot, "app.json");
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  appJson.window = {
    ...(appJson.window ?? {}),
    navigationBarTitleText: product.appName,
  };
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`, "utf8");

  const envKey = `WECHAT_${product.id.toUpperCase()}_APPID`;
  const projectConfig = {
    description: `${product.appName} generated product shell`,
    miniprogramRoot: "miniprogram/",
    compileType: "miniprogram",
    appid: process.env[envKey] || "touristappid",
    projectname: product.projectName,
    setting: {
      urlCheck: true,
      es6: true,
      enhance: true,
      postcss: true,
      minified: false,
    },
  };
  fs.writeFileSync(
    path.join(productRoot, "project.config.json"),
    `${JSON.stringify(projectConfig, null, 2)}\n`,
    "utf8",
  );
}
