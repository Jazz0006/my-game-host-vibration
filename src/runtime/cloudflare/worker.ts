import { GameRoomDurableObject } from "./GameRoomDurableObject.js";
import {
  resolveRoomStub,
  type DurableObjectNamespaceLike,
} from "./roomRouting.js";

export { GameRoomDurableObject };

export type CloudflareEnv = {
  GAME_ROOMS: DurableObjectNamespaceLike;
};

type RoomRoute = {
  roomCode: string;
  resource: "identity" | "snapshot";
};

function roomRouteFromPath(pathname: string): RoomRoute | null {
  const match = /^\/rooms\/(\d{4})\/(identity|snapshot)$/.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    roomCode: match[1],
    resource: match[2] as RoomRoute["resource"],
  };
}

async function roomRequest(request: Request, resource: RoomRoute["resource"]): Promise<Request> {
  const method = request.method.toUpperCase();
  return new Request(`https://game-room.internal/${resource}`, {
    method,
    headers: request.headers,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: await request.arrayBuffer() }),
  });
}

export const cloudflareWorker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "cloudflare" });
    }

    const route = roomRouteFromPath(url.pathname);
    if (!route) {
      return new Response("Not Found", { status: 404 });
    }

    const room = resolveRoomStub(env.GAME_ROOMS, route.roomCode);
    return room.fetch(await roomRequest(request, route.resource));
  },
};

export default cloudflareWorker;
