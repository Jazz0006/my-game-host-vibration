// ── Room state ─────────────────────────────────────────────────────────────
const roleIcons = { werewolf: "🐺", seer: "◉", witch: "⚗", guard: "♢", hunter: "⌖", villager: "●" };

function defaultSeatPosition(index, total) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(total, 1);
  return { x: 0.5 + Math.cos(angle) * 0.39, y: 0.5 + Math.sin(angle) * 0.36 };
}

function rectangularSideCounts(count) {
  const layouts = {
    9: [3, 2, 2, 2],
    10: [3, 2, 3, 2],
    11: [3, 3, 3, 2],
    12: [4, 2, 4, 2],
  };
  return layouts[count] || [4, 3, 4, Math.max(2, count - 11)];
}

function rectangularSeatPosition(index, total) {
  const [topCount, rightCount, bottomCount, leftCount] = rectangularSideCounts(total);
  let remaining = index;
  if (remaining < topCount) {
    return { x: 0.13 + 0.74 * (remaining + 1) / (topCount + 1), y: 0.12 };
  }
  remaining -= topCount;
  if (remaining < rightCount) {
    return { x: 0.89, y: 0.12 + 0.76 * (remaining + 1) / (rightCount + 1) };
  }
  remaining -= rightCount;
  if (remaining < bottomCount) {
    return { x: 0.87 - 0.74 * (remaining + 1) / (bottomCount + 1), y: 0.88 };
  }
  remaining -= bottomCount;
  return { x: 0.11, y: 0.88 - 0.76 * (remaining + 1) / (leftCount + 1) };
}

function seatPosition(index, total) {
  return total > 8
    ? rectangularSeatPosition(index, total)
    : defaultSeatPosition(index, total);
}

function insertMarkerPosition(insertIndex, total) {
  if (total === 0) return { x: 0.5, y: 0.5 };
  if (total <= 8) {
    const angle = -Math.PI / 2 + Math.PI * 2 * (insertIndex - 0.5) / total;
    return { x: 0.5 + Math.cos(angle) * 0.39, y: 0.5 + Math.sin(angle) * 0.36 };
  }
  const current = seatPosition(insertIndex === total ? 0 : insertIndex, total);
  const previous = seatPosition((insertIndex - 1 + total) % total, total);
  return { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
}

function nearestInsertIndex(point, total, rect) {
  if (total <= 8) {
    const angle = Math.atan2(
      (point.y - 0.5) * rect.height,
      (point.x - 0.5) * rect.width,
    );
    const normalized = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    return Math.max(0, Math.min(total, Math.round(normalized / (Math.PI * 2) * total)));
  }
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= total; index += 1) {
    const marker = insertMarkerPosition(index, total);
    const distance = Math.hypot(
      (marker.x - point.x) * rect.width,
      (marker.y - point.y) * rect.height,
    );
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function insertIndexChangesOrder(insertIndex, originalIndex) {
  const adjustedIndex = insertIndex > originalIndex ? insertIndex - 1 : insertIndex;
  return adjustedIndex !== originalIndex;
}

function previewSeatIndex(index, draggedIndex, insertIndex) {
  const adjustedIndex = insertIndex > draggedIndex ? insertIndex - 1 : insertIndex;
  if (index === draggedIndex) return adjustedIndex;
  const indexAfterRemoval = index > draggedIndex ? index - 1 : index;
  return indexAfterRemoval >= adjustedIndex ? indexAfterRemoval + 1 : indexAfterRemoval;
}

function setSeatNodePosition(node, position) {
  node.style.left = `${position.x * 100}%`;
  node.style.top = `${position.y * 100}%`;
}
