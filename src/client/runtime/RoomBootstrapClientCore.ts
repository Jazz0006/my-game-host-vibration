export type RoomBootstrapCredentials = {
  roomId: string;
  playerId: string;
  resumeToken: string;
  name: string;
  seat: number;
  isHost: boolean;
  revision: number;
};

export type RoomBootstrapHttpResponse = {
  statusCode: number;
  data: unknown;
};

export type RoomBootstrapPost = (
  url: string,
  data: unknown,
) => Promise<RoomBootstrapHttpResponse>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeRoomBootstrapBaseUrl(
  value: string,
  transportLabel = "Room bootstrap",
): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(normalized)) {
    throw new Error(`${transportLabel} baseUrl must use http or https`);
  }
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error(`${transportLabel} baseUrl must not contain query or hash`);
  }
  return normalized;
}

export function normalizeRoomCode(value: string): string {
  const roomCode = value.trim();
  if (!/^\d{4}$/u.test(roomCode)) {
    throw new Error("room code must be exactly 4 digits");
  }
  return roomCode;
}

export function parseRoomBootstrapResponse(
  response: RoomBootstrapHttpResponse,
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
    throw new Error(
      message || `Room bootstrap failed with status ${response.statusCode}`,
    );
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

/**
 * Transport-neutral create/join semantic owner shared by native and browser
 * clients. HTTP capability and platform-specific network diagnostics remain in
 * the adapters that provide the post function.
 */
export class RoomBootstrapClientCore {
  private readonly baseUrl: string;

  constructor(
    private readonly post: RoomBootstrapPost,
    options: { baseUrl: string; transportLabel?: string },
  ) {
    this.baseUrl = normalizeRoomBootstrapBaseUrl(
      options.baseUrl,
      options.transportLabel,
    );
  }

  createRoom(name?: string): Promise<RoomBootstrapCredentials> {
    return this.postAndParse(
      `${this.baseUrl}/rooms`,
      name?.trim() ? { name: name.trim() } : {},
    );
  }

  joinRoom(
    roomCode: string,
    name?: string,
  ): Promise<RoomBootstrapCredentials> {
    let normalized: string;
    try {
      normalized = normalizeRoomCode(roomCode);
    } catch (error) {
      return Promise.reject(error);
    }

    return this.postAndParse(
      `${this.baseUrl}/rooms/${encodeURIComponent(normalized)}/join`,
      name?.trim() ? { name: name.trim() } : {},
    );
  }

  private async postAndParse(
    url: string,
    data: unknown,
  ): Promise<RoomBootstrapCredentials> {
    return parseRoomBootstrapResponse(await this.post(url, data));
  }
}
