export type ClientEntryPresentationInput = {
  roomCode?: unknown;
  hasRecoverableRoom?: unknown;
};

export type ClientEntryPresentation = {
  roomCode: string;
  canJoinRoom: boolean;
  hasRecoverableRoom: boolean;
};

export function normalizeClientRoomCode(value: unknown): string {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
}

export function createClientEntryPresentation(
  input: ClientEntryPresentationInput,
): ClientEntryPresentation {
  const roomCode = normalizeClientRoomCode(input.roomCode);
  return {
    roomCode,
    canJoinRoom: /^\d{4}$/.test(roomCode),
    hasRecoverableRoom: Boolean(input.hasRecoverableRoom),
  };
}
