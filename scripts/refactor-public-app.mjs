import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const appPath = "public/app.js";
const corePath = "public/appCore.js";
const roomPath = "public/appRoom.js";
const indexPath = "public/index.html";
const marker = "// ── Room state ─────────────────────────────────────────────────────────────";

const app = readFileSync(appPath, "utf8");
const splitIndex = app.indexOf(marker);
if (splitIndex < 0) throw new Error("Room state split marker not found in public/app.js");

const core = `${app.slice(0, splitIndex).trimEnd()}\n`;
const room = `${app.slice(splitIndex).trimStart()}\n`;
if (!core.includes("function renderGameState")) throw new Error("Core split lost game rendering section");
if (!room.includes("socket.on(\"room:state\"")) throw new Error("Room split lost room state handler");

writeFileSync(corePath, core);
writeFileSync(roomPath, room);
unlinkSync(appPath);

const index = readFileSync(indexPath, "utf8");
const oldTag = "  <script src=\"/app.js\"></script>";
const newTags = [
  "  <script src=\"/appCore.js\"></script>",
  "  <script src=\"/appRoom.js\"></script>",
].join("\n");
if (!index.includes(oldTag)) throw new Error("public/index.html app.js script tag not found");
writeFileSync(indexPath, index.replace(oldTag, newTags));

console.log(`Split ${appPath}: core=${Buffer.byteLength(core)} bytes, room=${Buffer.byteLength(room)} bytes`);
