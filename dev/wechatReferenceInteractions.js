import {
  TABLE_WIDTH_RPX,
  TABLE_HEIGHT_RPX,
  resolveRoundedTableRingIndex,
} from "/client-runtime/client/RoundedTableLayout.js";

function pointerToTableRpx(table, event) {
  const rect = table.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * TABLE_WIDTH_RPX,
    y: ((event.clientY - rect.top) / rect.height) * TABLE_HEIGHT_RPX,
  };
}

export function bindSeatLongPressDrag(
  element,
  moderator,
  table,
  client,
  model,
  seat,
  sendCommand,
) {
  if (!model.isOwner || model.gameStarted) return;
  let timer = null;
  let dragging = false;
  let targetIndex = null;
  let overModerator = false;
  let pointerId = null;

  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    element.classList.remove("dragging");
    moderator.classList.remove("drop-target");
    dragging = false;
    targetIndex = null;
    overModerator = false;
    pointerId = null;
  };

  element.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    pointerId = event.pointerId;
    timer = window.setTimeout(() => {
      dragging = true;
      element.classList.add("dragging");
      try { element.setPointerCapture(pointerId); } catch {}
    }, 450);
  });

  element.addEventListener("pointermove", event => {
    if (!dragging) return;
    const moderatorRect = moderator.getBoundingClientRect();
    overModerator =
      event.clientX >= moderatorRect.left &&
      event.clientX <= moderatorRect.right &&
      event.clientY >= moderatorRect.top &&
      event.clientY <= moderatorRect.bottom;
    moderator.classList.toggle("drop-target", overModerator);
    if (overModerator) {
      targetIndex = null;
      return;
    }
    const point = pointerToTableRpx(table, event);
    targetIndex = point
      ? resolveRoundedTableRingIndex(point.x, point.y, model.playerOrder.length)
      : null;
  });

  const finish = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (!dragging) {
      cleanup();
      return;
    }

    if (overModerator) {
      void sendCommand(client, "room.setGameModerator", {
        assignment: { mode: "human", playerId: seat.id },
      });
      cleanup();
      return;
    }

    if (targetIndex !== null) {
      const originalIndex = model.playerOrder.indexOf(seat.id);
      const previewOrder = model.playerOrder.filter(id => id !== seat.id);
      const clamped = Math.max(0, Math.min(targetIndex, previewOrder.length));
      previewOrder.splice(clamped, 0, seat.id);
      const finalIndex = previewOrder.indexOf(seat.id);
      if (finalIndex !== originalIndex) {
        const nextVisibleId = previewOrder[finalIndex + 1];
        const fullOrder = [...model.participants]
          .sort((left, right) => left.seat - right.seat)
          .map(player => player.id);
        const insertIndex = nextVisibleId
          ? fullOrder.indexOf(nextVisibleId)
          : fullOrder.length;
        void sendCommand(client, "room.movePlayerSeat", {
          targetPlayerId: seat.id,
          insertIndex,
        });
      }
    }
    cleanup();
  };

  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", cleanup);
  element.addEventListener("pointerleave", event => {
    if (!dragging && event.buttons === 0) cleanup();
  });
}

export function bindModeratorLongPressDrag(
  moderator,
  table,
  client,
  model,
  sendCommand,
) {
  if (
    !model.isOwner ||
    model.gameStarted ||
    model.moderatorAssignment.mode !== "human"
  ) {
    return;
  }

  let timer = null;
  let dragging = false;
  let targetIndex = null;
  let pointerId = null;

  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    moderator.classList.remove("dragging");
    dragging = false;
    targetIndex = null;
    pointerId = null;
  };

  moderator.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    pointerId = event.pointerId;
    timer = window.setTimeout(() => {
      dragging = true;
      moderator.classList.add("dragging");
      try { moderator.setPointerCapture(pointerId); } catch {}
    }, 450);
  });

  moderator.addEventListener("pointermove", event => {
    if (!dragging) return;
    const moderatorRect = moderator.getBoundingClientRect();
    const stillInside =
      event.clientX >= moderatorRect.left &&
      event.clientX <= moderatorRect.right &&
      event.clientY >= moderatorRect.top &&
      event.clientY <= moderatorRect.bottom;
    if (stillInside) {
      targetIndex = null;
      return;
    }
    const point = pointerToTableRpx(table, event);
    targetIndex = point
      ? resolveRoundedTableRingIndex(point.x, point.y, model.playerOrder.length + 1)
      : null;
  });

  const finish = async () => {
    if (timer !== null) window.clearTimeout(timer);
    if (!dragging || targetIndex === null) {
      cleanup();
      return;
    }

    const playerId = model.moderatorAssignment.playerId;
    const visibleOrder = [...model.playerOrder];
    const clamped = Math.max(0, Math.min(targetIndex, visibleOrder.length));
    visibleOrder.splice(clamped, 0, playerId);
    const nextVisibleId = visibleOrder[clamped + 1];
    const fullOrder = [...model.participants]
      .sort((left, right) => left.seat - right.seat)
      .map(player => player.id);
    const insertIndex = nextVisibleId
      ? fullOrder.indexOf(nextVisibleId)
      : fullOrder.length;

    await sendCommand(client, "room.movePlayerSeat", {
      targetPlayerId: playerId,
      insertIndex,
    });
    await sendCommand(client, "room.setGameModerator", {
      assignment: { mode: "automatic" },
    });
    cleanup();
  };

  moderator.addEventListener("pointerup", () => { void finish(); });
  moderator.addEventListener("pointercancel", cleanup);
}
