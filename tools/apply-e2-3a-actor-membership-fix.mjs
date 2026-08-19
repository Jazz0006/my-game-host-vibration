import fs from "node:fs";

const path = "src/server.ts";
const before = "moduleActingPlayerIds(room).includes(player.id)";
const after = "onlineActingPlayers(room).some(actor => actor.id === player.id)";

const source = fs.readFileSync(path, "utf8");
const count = source.split(before).length - 1;
if (count !== 2) {
  throw new Error(`Expected 2 actor-membership references in ${path}, found ${count}. No files were changed.`);
}

const updated = source.split(before).join(after);
if (updated.includes("moduleActingPlayerIds(")) {
  throw new Error(`Unexpected moduleActingPlayerIds reference remains in ${path}. No files were changed.`);
}

fs.writeFileSync(path, updated);
console.log("Updated the 2 recovery actor-membership checks in src/server.ts successfully.");
