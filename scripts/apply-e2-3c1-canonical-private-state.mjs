import fs from "node:fs";

const path = "src/server.ts";
let source = fs.readFileSync(path, "utf8");

const effectImport = `import {
  emitActionAlertEffects,
  emitGameOverEffects,
  emitNightCompleteEffects,
} from "./runtime/node/SocketIoClientEffectDelivery.js";
`;
const stateImport = `import { emitPrivatePlayerState } from "./runtime/node/SocketIoClientStateDelivery.js";
`;
const legacyViewImport = `  playerGameView as modulePlayerGameView,
`;
const oldSendPrivateState = `function sendPrivateState(io: Server, room: Room, player: Player): void {
  if (!player.socketId) return;
  io.to(player.socketId).emit("player:game-state", modulePlayerGameView(room, player.id));
}
`;
const newSendPrivateState = `function sendPrivateState(io: Server, room: Room, player: Player): void {
  if (!player.socketId) return;
  emitPrivatePlayerState(io, room, player.id);
}
`;

function requireExactlyOnce(value, label) {
  const matches = source.split(value).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected exactly one ${label} in ${path}, found ${matches}. No files were changed.`);
  }
}

if (source.includes(stateImport)) {
  throw new Error(`${path} already imports SocketIoClientStateDelivery. No files were changed.`);
}

requireExactlyOnce(effectImport, "effect delivery import block");
requireExactlyOnce(legacyViewImport, "legacy modulePlayerGameView import");
requireExactlyOnce(oldSendPrivateState, "legacy sendPrivateState block");

source = source.replace(effectImport, `${effectImport}${stateImport}`);
source = source.replace(legacyViewImport, "");
source = source.replace(oldSendPrivateState, newSendPrivateState);

fs.writeFileSync(path, source);
console.log(`Updated ${path}: private PlayerView now originates from SocketIoClientStateDelivery.`);
console.log("Next: git diff --check && npm run typecheck && npm test");
