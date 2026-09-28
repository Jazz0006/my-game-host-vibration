import {
  normalizeRoomPlayerName,
  roomPlayerNameExists,
} from "../../core/room/RoomCore.js";
import type { RoomPlayer } from "../../core/room/types.js";

const PLAYER_NUMBER_LABELS = [
  "一", "二", "三", "四", "五", "六",
  "七", "八", "九", "十", "十一", "十二",
];

export function requestedRoomPlayerName(
  players: ReadonlyArray<Pick<RoomPlayer, "id" | "name">>,
  value?: string,
  now: () => number = Date.now,
): string {
  const requested = normalizeRoomPlayerName(value ?? "");
  const hasName = (candidate: string) =>
    roomPlayerNameExists(players, candidate);

  if (requested && !hasName(requested)) return requested;

  for (let index = 0; index < PLAYER_NUMBER_LABELS.length; index += 1) {
    const candidate = `新玩家${PLAYER_NUMBER_LABELS[index]}号`;
    if (!hasName(candidate)) return candidate;
  }

  return `新玩家${now().toString().slice(-4)}号`;
}
