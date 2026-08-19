import fs from "node:fs";

const plans = [
  {
    path: "src/server.ts",
    replacements: [
      [
        `import { SessionTokenService } from "./core/session/SessionTokenService.js";\n`,
        `import { SessionTokenService } from "./core/session/SessionTokenService.js";\nimport { createClientVibrateEffectEvent } from "./protocol/client/ClientEffects.js";\n`,
      ],
      [
`    if (player?.socketId) {
      io.to(player.socketId).emit("player:action-alert", {
        actionId: room.game.actionId,
        phase: room.game.phase,
        resumed,
      });
    }`,
`    if (player?.socketId) {
      const context = {
        actionId: room.game.actionId,
        phase: room.game.phase,
        resumed,
      };
      io.to(player.socketId).emit(
        "client:event",
        createClientVibrateEffectEvent([300, 150, 300], {
          reason: "action-alert",
          context,
        }),
      );
      // E2.2c compatibility: older clients still consume the legacy event.
      io.to(player.socketId).emit("player:action-alert", context);
    }`,
      ],
    ],
  },
  {
    path: "public/app.js",
    replacements: [
      [
        `socket.on("player:action-alert", () => vibrate([300, 150, 300]));\n`,
        ``,
      ],
    ],
  },
];

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

const outputs = [];
for (const plan of plans) {
  let source = fs.readFileSync(plan.path, "utf8");
  for (let index = 0; index < plan.replacements.length; index += 1) {
    const [before, after] = plan.replacements[index];
    const count = countOccurrences(source, before);
    if (count !== 1) {
      console.error(
        `ABORT: ${plan.path} replacement ${index + 1} expected exactly 1 match, found ${count}.`,
      );
      console.error("No files were written.");
      process.exit(1);
    }
    source = source.replace(before, after);
  }
  outputs.push({ path: plan.path, source });
}

for (const output of outputs) {
  fs.writeFileSync(output.path, output.source, "utf8");
}

console.log("Updated src/server.ts and public/app.js successfully (3 guarded replacements).");
console.log("Next: git diff --check && npm run typecheck && npm test");
