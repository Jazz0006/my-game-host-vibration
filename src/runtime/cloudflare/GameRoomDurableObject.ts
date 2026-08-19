type DurableObjectIdLike = {
  toString(): string;
};

type DurableObjectStateLike = {
  id: DurableObjectIdLike;
};

/**
 * Minimal D2.1 Durable Object shell.
 *
 * Persistence, alarms, and WebSockets intentionally arrive in D3/D4. This
 * class only proves that one room name can be routed to one authoritative
 * Cloudflare object instance without importing Cloudflare types into core.
 */
export class GameRoomDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/identity") {
      return new Response("Not Found", { status: 404 });
    }

    return Response.json({
      ok: true,
      objectId: this.state.id.toString(),
    });
  }
}
