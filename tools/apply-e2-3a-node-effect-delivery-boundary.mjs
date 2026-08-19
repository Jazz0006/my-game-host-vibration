import fs from "node:fs";

const files = new Map();

function read(path) {
  if (!files.has(path)) files.set(path, fs.readFileSync(path, "utf8"));
  return files.get(path);
}

function write(path, content) {
  files.set(path, content);
}

function replaceExact(path, before, after, expected = 1) {
  const source = read(path);
  const count = source.split(before).length - 1;
  if (count !== expected) {
    throw new Error(`Expected ${expected} occurrence(s) in ${path}, found ${count}. No files were changed.`);
  }
  write(path, source.split(before).join(after));
}

function replaceRegex(path, regex, replacement, expected) {
  const source = read(path);
  const matches = [...source.matchAll(regex)];
  if (matches.length !== expected) {
    throw new Error(`Expected ${expected} regex match(es) in ${path}, found ${matches.length}. No files were changed.`);
  }
  write(path, source.replace(regex, replacement));
}

const serverPath = "src/server.ts";
const protocolTransportPath = "src/runtime/node/SocketIoClientProtocolTransport.ts";
const timedServerPath = "src/timedServer.ts";

// ── src/server.ts ──────────────────────────────────────────────────────────
replaceExact(
  serverPath,
  `import { SessionTokenService } from "./core/session/SessionTokenService.js";\nimport {\n  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,\n  createClientAudioCueEffectEvent,\n  createClientVibrateEffectEvent,\n} from "./protocol/client/ClientEffects.js";`,
  `import { SessionTokenService } from "./core/session/SessionTokenService.js";\nimport {\n  emitActionAlertEffects,\n  emitGameOverEffects,\n  emitNightCompleteEffects,\n} from "./runtime/node/SocketIoClientEffectDelivery.js";`,
);

replaceExact(
  serverPath,
  `import {\n  actingPlayerIds as moduleActingPlayerIds,\n  createWerewolfGame,`,
  `import {\n  createWerewolfGame,`,
);

replaceExact(
  serverPath,
  "moduleActingPlayerIds(room).includes(player.id)",
  "onlineActingPlayers(room).some(actor => actor.id === player.id)",
  2,
);

replaceRegex(
  serverPath,
  /function alertCurrentActors[\s\S]*?\nfunction afterNightAction/g,
  "function afterNightAction",
  1,
);

replaceExact(
  serverPath,
  "alertCurrentActors(io, room);",
  "emitActionAlertEffects(io, room, { resumed: false });",
  5,
);
replaceExact(
  serverPath,
  "alertCurrentActors(io, membership.room);",
  "emitActionAlertEffects(io, membership.room, { resumed: false });",
  1,
);
replaceExact(
  serverPath,
  "alertCurrentActors(io, room, true);",
  "emitActionAlertEffects(io, room, { resumed: true });",
  3,
);

// ── SocketIoClientProtocolTransport.ts ─────────────────────────────────────
replaceExact(
  protocolTransportPath,
  `import {\n  actingPlayerIds,\n  type RuntimeRoom,\n} from "./roomBridge.js";`,
  `import type { RuntimeRoom } from "./roomBridge.js";\nimport {\n  emitActionAlertEffects,\n  emitGameOverEffects,\n  emitNightCompleteEffects,\n} from "./SocketIoClientEffectDelivery.js";`,
);

replaceRegex(
  protocolTransportPath,
  /function alertCurrentActors[\s\S]*?\nfunction afterNightAction/g,
  "function afterNightAction",
  1,
);

replaceRegex(
  protocolTransportPath,
  /io\.to\(room\.id\)\.emit\("game:over", \{ winner: (?:game|room\.game)\.winner \}\);/g,
  "emitGameOverEffects(io, room);",
  3,
);
replaceExact(
  protocolTransportPath,
  'io.to(room.id).emit("game:night-complete", { actionId: game.actionId });',
  "emitNightCompleteEffects(io, room);",
  2,
);
replaceExact(
  protocolTransportPath,
  "alertCurrentActors(io, room);",
  "emitActionAlertEffects(io, room);",
  5,
);

// ── src/timedServer.ts ─────────────────────────────────────────────────────
replaceExact(
  timedServerPath,
  `import {\n  actingPlayerIds,\n  activeInteraction,\n  type RuntimeRoom,\n} from "./runtime/node/roomBridge.js";`,
  `import { activeInteraction, type RuntimeRoom } from "./runtime/node/roomBridge.js";\nimport {\n  emitActionAlertEffects,\n  emitGameOverEffects,\n  emitNightCompleteEffects,\n} from "./runtime/node/SocketIoClientEffectDelivery.js";`,
);

replaceRegex(
  timedServerPath,
  /function alertCurrentActors[\s\S]*?\nfunction emitTimeoutState/g,
  "function emitTimeoutState",
  1,
);

replaceExact(
  timedServerPath,
  'io.to(room.id).emit("game:over", { winner: game.winner });',
  "emitGameOverEffects(io, room);",
  1,
);
replaceExact(
  timedServerPath,
  'io.to(room.id).emit("game:night-complete", { actionId: game.actionId });',
  "emitNightCompleteEffects(io, room);",
  2,
);
replaceExact(
  timedServerPath,
  "alertCurrentActors(io, room);",
  "emitActionAlertEffects(io, room, { timeoutWarning: false });",
  3,
);
replaceExact(
  timedServerPath,
  "alertCurrentActors(io, room, true);",
  "emitActionAlertEffects(io, room, { timeoutWarning: true });",
  1,
);

// Validate the contraction before writing anything.
for (const [path, content] of files) {
  if (content.includes("alertCurrentActors(")) {
    throw new Error(`Unexpected alertCurrentActors remains in ${path}. No files were changed.`);
  }
}
for (const path of [serverPath, protocolTransportPath, timedServerPath]) {
  const content = files.get(path);
  for (const eventName of ["player:action-alert", "game:night-complete", "game:over"]) {
    if (content.includes(`"${eventName}"`)) {
      throw new Error(`Legacy effect event ${eventName} still exists in ${path}. No files were changed.`);
    }
  }
}

for (const [path, content] of files) {
  fs.writeFileSync(path, content);
}

console.log(
  "Updated src/server.ts, SocketIoClientProtocolTransport.ts, and src/timedServer.ts successfully.\n" +
  "Next: git diff --check && npm run typecheck && npm test",
);
