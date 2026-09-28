export type RawWebSocketTicketResponse = {
  ok: true;
  ticket: string;
  expiresAt?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeRawWebSocketBaseUrl(
  value: string,
  transportLabel = "Raw WebSocket",
): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`${transportLabel} realtime baseUrl must use http or https`);
  }
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error(`${transportLabel} realtime baseUrl must not contain query or hash`);
  }
  return normalized;
}

export function rawWebSocketRoomResourceUrl(
  baseUrl: string,
  roomId: string,
  resource: string,
): string {
  return `${baseUrl}/rooms/${encodeURIComponent(roomId)}/${resource}`;
}

export function rawWebSocketUrl(
  baseUrl: string,
  roomId: string,
  ticket: string,
): string {
  const httpUrl = rawWebSocketRoomResourceUrl(baseUrl, roomId, "websocket");
  const wsUrl = httpUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return `${wsUrl}?ticket=${encodeURIComponent(ticket)}`;
}

export function parseRawWebSocketTicketResponse(
  statusCode: number,
  data: unknown,
): RawWebSocketTicketResponse {
  const record = asRecord(data);
  const message = typeof record?.message === "string" ? record.message.trim() : "";
  if (
    statusCode < 200 ||
    statusCode >= 300 ||
    record?.ok !== true ||
    typeof record.ticket !== "string" ||
    !record.ticket.trim()
  ) {
    throw new Error(
      message || `WebSocket ticket request failed with status ${statusCode}`,
    );
  }

  return {
    ok: true,
    ticket: record.ticket.trim(),
    ...(Number.isFinite(record.expiresAt)
      ? { expiresAt: Number(record.expiresAt) }
      : {}),
  };
}
