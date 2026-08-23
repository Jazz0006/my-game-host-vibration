import fs from "node:fs";
import path from "node:path";

export const PUBLIC_APP_SCRIPT_PATHS = [
  "public/appCore.js",
  "public/appGame.js",
  "public/appRoomGeometry.js",
  "public/appRoomReordering.js",
  "public/appRoomState.js",
  "public/appActions.js",
] as const;

export const PUBLIC_APP_SCRIPT_URLS = PUBLIC_APP_SCRIPT_PATHS.map(filePath =>
  `/${path.basename(filePath)}`
);

export function publicAppSource(repoRoot = process.cwd()): string {
  return PUBLIC_APP_SCRIPT_PATHS
    .map(filePath => fs.readFileSync(path.join(repoRoot, filePath), "utf8"))
    .join("\n");
}
