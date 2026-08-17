export type GameEvent<TPayload = unknown> = {
  id: string;
  seq: number;
  timestamp: number;
  type: string;
  actorId?: string;
  targetId?: string;
  payload?: TPayload;
};

export type GameEventDraft<TPayload = unknown> = Omit<GameEvent<TPayload>, "id" | "seq" | "timestamp">;
