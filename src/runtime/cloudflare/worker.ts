import { GameRoomDurableObject } from "./GameRoomDurableObject.js";
import {
  resolveRoomStub,
  type DurableObjectNamespaceLike,
} from "./roomRouting.js";

export { GameRoomDurableObject };

export type CloudflareEnv = {
  GAME_ROOMS: DurableObjectNamespaceLike;
};

function roomCodeFromPath(pathname: string): string | null {
  const match = /^\/rooms\/(\d{4})\/identity$/.exec(pathname);
  return match?.[1] ?? null;
}

export const cloudflareWorker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "cloudflare" });
    }

    const roomCode = roomCodeFromPath(url.pathname);
    if (!roomCode) {
      return new Response("Not Found", { status: 404 });
    }

    const room = resolveRoomStub(env.GAME_ROOMS, roomCode);
    return room.fetch(new Request("https://game-room.internal/identity"));
  },
};

export default cloudflareWorker;
