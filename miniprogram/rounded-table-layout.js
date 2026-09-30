const TABLE_WIDTH_RPX = 640;
const TABLE_HEIGHT_RPX = 720;
const CARD_WIDTH_RPX = 120;
const CARD_HEIGHT_RPX = 72;

function pointAtDistance(distance, topLength, sideLength) {
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

function seatPointAtIndex(index, count) {
  const usableWidth = TABLE_WIDTH_RPX - CARD_WIDTH_RPX;
  const usableHeight = TABLE_HEIGHT_RPX - CARD_HEIGHT_RPX;
  const perimeter = 2 * (usableWidth + usableHeight);
  const startOffset = usableWidth / 2;
  const distance = startOffset + (perimeter * index) / count;
  return pointAtDistance(distance, usableWidth, usableHeight);
}

function computeRoundedTableSeats(playerOrder, participants) {
  const order = Array.isArray(playerOrder) ? playerOrder : [];
  const byId = participants || {};
  if (order.length === 0) return [];

  return order.map((playerId, index) => {
    const participant = byId[playerId] || { id: playerId, name: playerId };
    const point = seatPointAtIndex(index, order.length);

    return {
      ...participant,
      ringIndex: index,
      style: `left:${Math.round(point.x)}rpx;top:${Math.round(point.y)}rpx;`,
    };
  });
}

function resolveRoundedTableRingIndex(xRpx, yRpx, playerCount) {
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

module.exports = {
  TABLE_WIDTH_RPX,
  TABLE_HEIGHT_RPX,
  computeRoundedTableSeats,
  resolveRoundedTableRingIndex,
};
