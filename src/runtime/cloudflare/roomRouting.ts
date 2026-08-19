export type DurableObjectStubLike = {
  fetch(request: Request): Promise<Response>;
};

export type DurableObjectNamespaceLike = {
  getByName(name: string): DurableObjectStubLike;
};

export function normalizeRoomCode(value: string): string {
  const roomCode = value.trim();
  if (!/^\d{4}$/.test(roomCode)) {
    throw new Error("roomCode must be exactly 4 digits");
  }
  return roomCode;
}

/**
 * D2.1 routing contract: the room code is the stable Durable Object name.
 * Cloudflare owns the actual object identity; platform code only chooses the
 * stable room key and asks the namespace for its stub.
 */
export function resolveRoomStub(
  namespace: DurableObjectNamespaceLike,
  roomCode: string,
): DurableObjectStubLike {
  return namespace.getByName(normalizeRoomCode(roomCode));
}
