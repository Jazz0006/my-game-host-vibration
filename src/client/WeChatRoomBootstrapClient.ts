export type WeChatRoomBootstrapRequestApi = {
  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }): void;
};

export type RoomBootstrapCredentials = {
  roomId: string;
  playerId: string;
  resumeToken: string;
  name: string;
  seat: number;
  isHost: boolean;
  revision: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(normalized)) {
    throw new Error("WeChat room bootstrap baseUrl must use http or https");
  }
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error("WeChat room bootstrap baseUrl must not contain query or hash");
  }
  return normalized;
}

function normalizeRoomCode(value: string): string {
  const roomCode = value.trim();
  if (!/^\d{4}$/u.test(roomCode)) throw new Error("room code must be exactly 4 digits");
  return roomCode;
}

function parseBootstrapResponse(
  response: { statusCode: number; data: unknown },
): RoomBootstrapCredentials {
  const record = asRecord(response.data);
  const message = typeof record?.message === "string" ? record.message.trim() : "";
  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    record?.ok !== true ||
    typeof record.roomId !== "string" ||
    typeof record.playerId !== "string" ||
    typeof record.resumeToken !== "string" ||
    typeof record.name !== "string" ||
    typeof record.seat !== "number" ||
    typeof record.isHost !== "boolean" ||
    typeof record.revision !== "number"
  ) {
    throw new Error(message || `Room bootstrap failed with status ${response.statusCode}`);
  }

  return {
    roomId: record.roomId,
    playerId: record.playerId,
    resumeToken: record.resumeToken,
    name: record.name,
    seat: record.seat,
    isHost: record.isHost,
    revision: record.revision,
  };
}

export class WeChatRoomBootstrapClient {
  private readonly baseUrl: string;

  constructor(
    private readonly api: WeChatRoomBootstrapRequestApi,
    options: { baseUrl: string },
  ) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
  }

  createRoom(name?: string): Promise<RoomBootstrapCredentials> {
    return this.post(`${this.baseUrl}/rooms`, name?.trim() ? { name: name.trim() } : {});
  }

  joinRoom(roomCode: string, name?: string): Promise<RoomBootstrapCredentials> {
    let normalized: string;
    try {
      normalized = normalizeRoomCode(roomCode);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.post(
      `${this.baseUrl}/rooms/${encodeURIComponent(normalized)}/join`,
      name?.trim() ? { name: name.trim() } : {},
    );
  }

  private post(url: string, data: unknown): Promise<RoomBootstrapCredentials> {
    return new Promise((resolve, reject) => {
      this.api.request({
        url,
        method: "POST",
        data,
        success: response => {
          try {
            resolve(parseBootstrapResponse(response));
          } catch (error) {
            reject(error);
          }
        },
        fail: error => {
          reject(error instanceof Error ? error : new Error("Room bootstrap request failed"));
        },
      });
    });
  }
}
