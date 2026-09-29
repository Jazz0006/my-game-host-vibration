import {
  RoomBootstrapClientCore,
  type RoomBootstrapCredentials,
} from "../runtime/RoomBootstrapClientCore.js";

export type BrowserRoomBootstrapFetchResponseLike = {
  status: number;
  json(): Promise<unknown>;
};

export type BrowserRoomBootstrapFetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: { "content-type": "application/json" };
    body: string;
  },
) => Promise<BrowserRoomBootstrapFetchResponseLike>;

export type BrowserRoomBootstrapClientOptions = {
  baseUrl: string;
  fetch?: BrowserRoomBootstrapFetchLike;
};

const defaultBrowserFetch: BrowserRoomBootstrapFetchLike = (url, init) =>
  globalThis.fetch(url, init);

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Room bootstrap request failed";
}

/**
 * Browser fetch adapter for the same Cloudflare room bootstrap contract used by
 * the native WeChat client.
 */
export class BrowserRoomBootstrapClient {
  private readonly fetchImpl: BrowserRoomBootstrapFetchLike;
  private readonly core: RoomBootstrapClientCore;

  constructor(options: BrowserRoomBootstrapClientOptions) {
    this.fetchImpl = options.fetch ?? defaultBrowserFetch;
    this.core = new RoomBootstrapClientCore(
      (url, data) => this.post(url, data),
      {
        baseUrl: options.baseUrl,
        transportLabel: "Browser room bootstrap",
      },
    );
  }

  createRoom(name?: string): Promise<RoomBootstrapCredentials> {
    return this.core.createRoom(name);
  }

  joinRoom(
    roomCode: string,
    name?: string,
  ): Promise<RoomBootstrapCredentials> {
    return this.core.joinRoom(roomCode, name);
  }

  private async post(
    url: string,
    data: unknown,
  ): Promise<{ statusCode: number; data: unknown }> {
    let response: BrowserRoomBootstrapFetchResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (error) {
      throw new Error(errorMessage(error));
    }

    let responseData: unknown = null;
    try {
      responseData = await response.json();
    } catch {
      // The shared semantic parser will report a stable status-based failure.
    }

    return {
      statusCode: response.status,
      data: responseData,
    };
  }
}
