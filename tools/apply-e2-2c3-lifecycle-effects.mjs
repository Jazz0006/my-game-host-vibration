import fs from "node:fs";

const plans = [
  {
    path: "src/server.ts",
    replacements: [
      {
        expected: 1,
        from: 'import { createClientVibrateEffectEvent } from "./protocol/client/ClientEffects.js";',
        to: `import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  createClientAudioCueEffectEvent,
  createClientVibrateEffectEvent,
} from "./protocol/client/ClientEffects.js";`,
      },
      {
        expected: 1,
        from: `function afterNightAction(io: Server, room: Room): void {`,
        to: `function emitNightCompleteEffects(io: Server, room: Room): void {
  if (!room.game) return;
  const context = { actionId: room.game.actionId };
  io.to(room.id).emit(
    "client:event",
    createClientVibrateEffectEvent([160, 100, 160, 100, 500], {
      reason: "night-complete",
      context,
    }),
  );

  const host = room.players.find(player => player.isHost);
  if (host?.socketId) {
    io.to(host.socketId).emit(
      "client:event",
      createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE, {
        reason: "night-complete",
        context,
      }),
    );
  }

  // E2.2c compatibility: older clients still consume the legacy event.
  io.to(room.id).emit("game:night-complete", context);
}

function emitGameOverEffects(io: Server, room: Room): void {
  const winner = room.game?.winner;
  if (!winner) return;
  const context = { winner };
  io.to(room.id).emit(
    "client:event",
    createClientVibrateEffectEvent([500, 200, 500, 200, 500], {
      reason: "game-over",
      context,
    }),
  );

  // E2.2c compatibility: older clients still consume the legacy event.
  io.to(room.id).emit("game:over", context);
}

function afterNightAction(io: Server, room: Room): void {`,
      },
      {
        expected: 1,
        from: '    io.to(room.id).emit("game:over", { winner: game.winner });',
        to: '    emitGameOverEffects(io, room);',
      },
      {
        expected: 2,
        from: '    io.to(room.id).emit("game:night-complete", { actionId: game.actionId });',
        to: '    emitNightCompleteEffects(io, room);',
      },
      {
        expected: 1,
        from: '    io.to(room.id).emit("game:over", { winner: room.game.winner });',
        to: '    emitGameOverEffects(io, room);',
      },
      {
        expected: 1,
        from: '              io.to(membership.room.id).emit("game:over", { winner: game.winner });',
        to: '              emitGameOverEffects(io, membership.room);',
      },
    ],
  },
  {
    path: "public/app.js",
    replacements: [
      {
        expected: 1,
        from: `// ── Audio ──────────────────────────────────────────────────────────────────
function playNightEndAudio() {
  try {
    const ctx = new AudioContext();
    const notes = [880, 1108, 1318, 880];
    let t = ctx.currentTime;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
      t += 0.35;
    }
  } catch {}
}

// ── Game events ────────────────────────────────────────────────────────────
// Authoritative private PlayerView now arrives through ClientSession/client:state.
socket.on("game:night-complete", () => {
  vibrate([160, 100, 160, 100, 500]);
  if (isHost) playNightEndAudio();
});
socket.on("game:over", () => vibrate([500, 200, 500, 200, 500]));`,
        to: `// ── Game events ────────────────────────────────────────────────────────────
// Authoritative private PlayerView and migrated lifecycle effects now arrive
// through ClientSession/client:state and ClientSession/client:event.`,
      },
    ],
  },
];

function occurrences(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

const outputs = new Map();
let replacementNumber = 0;

for (const plan of plans) {
  let source = fs.readFileSync(plan.path, "utf8");
  for (const replacement of plan.replacements) {
    replacementNumber += 1;
    const found = occurrences(source, replacement.from);
    if (found !== replacement.expected) {
      console.error(
        `ABORT: replacement ${replacementNumber} in ${plan.path} expected exactly ${replacement.expected} match(es), found ${found}.`,
      );
      console.error("No file was written.");
      process.exit(1);
    }
    source = source.split(replacement.from).join(replacement.to);
  }
  outputs.set(plan.path, source);
}

for (const [path, source] of outputs) {
  fs.writeFileSync(path, source, "utf8");
}

console.log(`Updated ${[...outputs.keys()].join(" and ")} successfully (${replacementNumber} guarded replacements).`);
console.log("Next: git diff --check && npm run typecheck && npm test");
