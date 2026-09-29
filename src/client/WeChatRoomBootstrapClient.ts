import {
  RoomBootstrapClientCore,
  type RoomBootstrapCredentials,
} from "./runtime/RoomBootstrapClientCore.js";

export type { RoomBootstrapCredentials } from "./runtime/RoomBootstrapClientCore.js";

export type WeChatRoomBootstrapRequestApi = {
  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }): void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requestFailureError(value: unknown): Error {
  if (value instanceof Error) return value;
  const record = asRecord(value);
  const errMsg =
    typeof record?.errMsg === "string" && record.errMsg.trim()
      ? record.errMsg.trim()
      : "Room bootstrap request failed";
  const errno =
    typeof record?.errno === "number" || typeof record?.errno === "string"
      ? String(record.errno).trim()
      : "";
  return new Error(errno ? `${errMsg} (errno ${errno})` : errMsg);
}

/**
 * WeChat HTTP capability adapter for the shared room-bootstrap semantic core.
 * wx.request diagnostics stay platform-owned here.
 */
export class WeChatRoomBootstrapClient {
  private readonly core: RoomBootstrapClientCore;

  constructor(
    private readonly api: WeChatRoomBootstrapRequestApi,
    options: { baseUrl: string; gameType?: string },
  ) {
    this.core = new RoomBootstrapClientCore(
      (url, data) => this.post(url, data),
      {
        baseUrl: options.baseUrl,
        gameType: options.gameType ?? "werewolf",
        transportLabel: "WeChat room bootstrap",
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

  private post(
    url: string,
    data: unknown,
  ): Promise<{ statusCode: number; data: unknown }> {
    return new Promise((resolve, reject) => {
      this.api.request({
        url,
        method: "POST",
        data,
        success: resolve,
        fail: error => reject(requestFailureError(error)),
      });
    });
  }
}
