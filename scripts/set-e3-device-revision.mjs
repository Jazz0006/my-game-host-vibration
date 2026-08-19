import { readFile, writeFile } from "node:fs/promises";

const revisionArg = process.argv[2];
const revision = Number(revisionArg);

if (!Number.isInteger(revision) || revision < 0) {
  console.error("Usage: npm run e3:revision -- <non-negative revision>");
  process.exit(1);
}

const snapshotPath = process.env.E3_SNAPSHOT_PATH || "/tmp/e3-lobby.json";
const baseUrl = (process.env.BASE_URL || "https://my-game-host-vibration.jazz-zeng.workers.dev").replace(/\/$/, "");

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const roomId = process.env.ROOM_ID || snapshot?.metadata?.roomId;

if (!roomId) {
  console.error("ROOM_ID is not set and snapshot.metadata.roomId is missing");
  process.exit(1);
}

snapshot.revision = revision;
if (snapshot.metadata && typeof snapshot.metadata === "object") {
  snapshot.metadata.updatedAt = Date.now();
}

await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const response = await fetch(`${baseUrl}/rooms/${encodeURIComponent(roomId)}/snapshot`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(snapshot),
});

const body = await response.text();

if (!response.ok) {
  console.error(`Snapshot upload failed: HTTP ${response.status}`);
  if (body) console.error(body);
  process.exit(1);
}

console.log(`E3 snapshot updated: room=${roomId} revision=${revision}`);
if (body) console.log(body);
