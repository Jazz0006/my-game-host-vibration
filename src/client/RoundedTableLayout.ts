export const TABLE_WIDTH_RPX = 640;
export const TABLE_HEIGHT_RPX = 720;
export const CARD_WIDTH_RPX = 120;
export const CARD_HEIGHT_RPX = 72;

export type RoundedTableParticipant = {
  id: string;
  name?: string;
  [key: string]: unknown;
};

export type RoundedTableSeat<T extends RoundedTableParticipant> = T & {
  ringIndex: number;
  xRpx: number;
  yRpx: number;
};

function pointAtDistance(
  distance: number,
  topLength: number,
  sideLength: number,
): { x: number; y: number } {
  const perimeter = 2 * (topLength + sideLength);
  let d = ((distance % perimeter) + perimeter) % perimeter;

  if (d <= topLength) return { x: d, y: 0 };
  d -= topLength;
  if (d <= sideLength) return { x: topLength, y: d };
  d -= sideLength;
  if (d <= topLength) return { x: topLength - d, y: sideLength };
  d -= topLength;
  return { x: 0, y: sideLength - d };
}

function seatPointAtIndex(index: number, count: number): { x: number; y: number } {
  const usableWidth = TABLE_WIDTH_RPX - CARD_WIDTH_RPX;
  const usableHeight = TABLE_HEIGHT_RPX - CARD_HEIGHT_RPX;
  const perimeter = 2 * (usableWidth + usableHeight);
  const startOffset = usableWidth / 2;
  const distance = startOffset + (perimeter * index) / count;
  return pointAtDistance(distance, usableWidth, usableHeight);
}

export function computeRoundedTableSeats<T extends RoundedTableParticipant>(
  playerOrder: string[],
  participants: Record<string, T>,
): RoundedTableSeat<T>[] {
  const order = Array.isArray(playerOrder) ? playerOrder : [];
  const byId = participants || {};
  if (order.length === 0) return [];

  return order.map((playerId, index) => {
    const participant = byId[playerId] ?? ({ id: playerId, name: playerId } as T);
    const point = seatPointAtIndex(index, order.length);
    return {
      ...participant,
      ringIndex: index,
      xRpx: Math.round(point.x),
      yRpx: Math.round(point.y),
    };
  });
}

export function resolveRoundedTableRingIndex(
  xRpx: number,
  yRpx: number,
  playerCount: number,
): number | null {
  if (!Number.isFinite(xRpx) || !Number.isFinite(yRpx)) return null;
  if (!Number.isInteger(playerCount) || playerCount <= 0) return null;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < playerCount; index += 1) {
    const point = seatPointAtIndex(index, playerCount);
    const centerX = point.x + CARD_WIDTH_RPX / 2;
    const centerY = point.y + CARD_HEIGHT_RPX / 2;
    const dx = xRpx - centerX;
    const dy = yRpx - centerY;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}
