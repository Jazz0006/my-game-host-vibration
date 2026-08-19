import fs from "node:fs";

const path = "src/server.ts";
const original = fs.readFileSync(path, "utf8");
const before = `          await runHostRecoveryCommandIdempotent(room, commandId, () => {
            const actors = onlineActingPlayers(room);
            if (actors.length === 0) {
              throw new GameRuleError("当前没有在线的行动玩家需要提醒");
            }

            for (const actor of actors) {
              io.to(actor.socketId!).emit("player:action-alert", {
                actionId: room.game!.actionId,
                phase: room.game!.phase,
                resumed: true,
              });
            }

            return {
              kind: "hostRecoveryReminder",
              actorPlayerIds: actors.map(actor => actor.id),
            };
          });`;
const after = `          await runHostRecoveryCommandIdempotent(room, commandId, () => {
            const actors = onlineActingPlayers(room);
            if (actors.length === 0) {
              throw new GameRuleError("当前没有在线的行动玩家需要提醒");
            }

            alertCurrentActors(io, room, true);

            return {
              kind: "hostRecoveryReminder",
              actorPlayerIds: actors.map(actor => actor.id),
            };
          });`;

const occurrences = original.split(before).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly 1 guarded resend block in ${path}, found ${occurrences}. No file was changed.`);
}

const updated = original.replace(before, after);
fs.writeFileSync(path, updated);
console.log("Updated src/server.ts successfully (1 guarded replacement).\nNext: git diff --check && npm run typecheck && npm test");
