import { isGameType } from "../../games/GameCatalog.js";
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
  resource: "identity" | "identity-recovery" | "websocket-ticket" | "websocket";
};

const CREATE_ROOM_ATTEMPTS = 20;

function roomRouteFromPath(pathname: string): RoomRoute | null {
  const match = /^\/rooms\/(\d{4})\/(identity|identity-recovery|websocket-ticket|websocket)$/.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    roomCode: match[1],
    resource: match[2] as RoomRoute["resource"],
  };
}

function joinRoomCode(pathname: string): string | null {
  return /^\/rooms\/(\d{4})\/join$/u.exec(pathname)?.[1] ?? null;
}

function randomRoomCode(): string {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return String(1000 + (value[0]! % 9000));
}

async function roomRequest(request: Request, resource: string): Promise<Request> {
  const method = request.method.toUpperCase();
  const sourceUrl = new URL(request.url);
  const internalUrl = new URL(`https://game-room.internal/${resource}`);
  internalUrl.search = sourceUrl.search;

  return new Request(internalUrl, {
    method,
    headers: request.headers,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: await request.arrayBuffer() }),
  });
}

async function readCreateBody(request: Request): Promise<{
  gameType?: unknown;
  name?: unknown;
} | null> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return {
      gameType: record.gameType,
      ...(record.name === undefined ? {} : { name: record.name }),
    };
  } catch {
    return null;
  }
}

async function createRoom(request: Request, env: CloudflareEnv): Promise<Response> {
  const body = await readCreateBody(request);
  if (!body) {
    return Response.json(
      { ok: false, code: "invalid_request", message: "invalid request body" },
      { status: 400 },
    );
  }
  if (!isGameType(body.gameType)) {
    return Response.json(
      { ok: false, code: "invalid_game_type", message: "unsupported gameType" },
      { status: 400 },
    );
  }

  for (let attempt = 0; attempt < CREATE_ROOM_ATTEMPTS; attempt += 1) {
    const roomCode = randomRoomCode();
    const room = resolveRoomStub(env.GAME_ROOMS, roomCode);
    const internalRequest = new Request("https://game-room.internal/bootstrap-create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: roomCode,
        gameType: body.gameType,
        ...(body.name === undefined ? {} : { name: body.name }),
      }),
    });
    const response = await room.fetch(internalRequest);
    if (response.status !== 409) return response;

    let code: unknown;
    try {
      code = (await response.clone().json() as { code?: unknown }).code;
    } catch {
      return response;
    }
    if (code !== "room_already_exists") return response;
  }

  return Response.json(
    { ok: false, code: "room_code_unavailable", message: "暂时无法创建房间号" },
    { status: 503 },
  );
}

export const cloudflareWorker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "cloudflare" });
    }

    if (url.pathname === "/rooms" && request.method === "POST") {
      return createRoom(request, env);
    }

    const joinCode = joinRoomCode(url.pathname);
    if (joinCode && request.method === "POST") {
      const room = resolveRoomStub(env.GAME_ROOMS, joinCode);
      return room.fetch(await roomRequest(request, "bootstrap-join"));
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

