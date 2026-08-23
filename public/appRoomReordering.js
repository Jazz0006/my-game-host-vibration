function makeSeatNode(player, index, total) {
  const node = document.createElement("div");
  node.className = `seat-player${isHost ? " movable" : ""}${player.connected ? "" : " offline"}${player.id === currentPlayerId ? " self" : ""}`;
  setSeatNodePosition(node, seatPosition(index, total));
  node.innerHTML = `<span class="seat-number">${player.seat}</span><span class="seat-player-name"></span>`;
  node.querySelector(".seat-player-name").textContent = player.name;
  node.title = isHost ? "长按并拖动调整座位顺序" : `${player.seat}号 ${player.name}`;
  node.setAttribute("aria-label", `${player.seat}号 ${player.name}${player.isHost ? "，房主" : ""}`);
  return node;
}

function enableSeatReordering(players, nodes) {
  const map = $("seat-map");
  const marker = document.createElement("div");
  marker.className = "seat-insert-marker hidden";
  marker.textContent = "+";
  map.append(marker);

  function resetPreview() {
    nodes.forEach((node, index) => setSeatNodePosition(node, seatPosition(index, players.length)));
    marker.classList.add("hidden");
  }

  nodes.forEach((node, draggedIndex) => {
    let holdTimer = 0;
    let dragging = false;
    let insertIndex = null;
    let startPoint = null;

    function pointFromEvent(event) {
      const rect = map.getBoundingClientRect();
      return {
        rect,
        point: {
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        },
      };
    }

    function beginDrag(event) {
      dragging = true;
      node.classList.add("dragging");
      map.classList.add("reordering");
      updateDrag(event);
    }

    function updateDrag(event) {
      if (!dragging) return;
      const { rect, point } = pointFromEvent(event);
      setSeatNodePosition(node, point);
      const insideMap = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
      insertIndex = insideMap ? nearestInsertIndex(point, players.length, rect) : null;
      if (insertIndex === null || !insertIndexChangesOrder(insertIndex, draggedIndex)) {
        nodes.forEach((otherNode, index) => {
          if (index !== draggedIndex) setSeatNodePosition(otherNode, seatPosition(index, players.length));
        });
        marker.classList.add("hidden");
        return;
      }

      nodes.forEach((otherNode, index) => {
        if (index === draggedIndex) return;
        setSeatNodePosition(
          otherNode,
          seatPosition(previewSeatIndex(index, draggedIndex, insertIndex), players.length),
        );
      });
      setSeatNodePosition(marker, insertMarkerPosition(insertIndex, players.length));
      marker.classList.remove("hidden");
    }

    function finishDrag(event, cancelled = false) {
      window.clearTimeout(holdTimer);
      if (!dragging) return;
      const destination = insertIndex;
      dragging = false;
      if (event && node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      node.classList.remove("dragging");
      map.classList.remove("reordering");
      insertIndex = null;
      resetPreview();
      if (!cancelled && destination !== null && insertIndexChangesOrder(destination, draggedIndex)) {
        emitWithAck("host:move-player-seat", {
          targetPlayerId: players[draggedIndex].id,
          insertIndex: destination,
        });
      }
    }

    node.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch" && event.button !== 0) return;
      startPoint = { x: event.clientX, y: event.clientY };
      node.setPointerCapture(event.pointerId);
      if (event.pointerType !== "touch") {
        event.preventDefault();
        beginDrag(event);
      } else {
        holdTimer = window.setTimeout(() => beginDrag(event), 260);
      }
    });
    node.addEventListener("pointermove", event => {
      if (event.pointerType === "touch" && !dragging && startPoint && Math.hypot(
        event.clientX - startPoint.x,
        event.clientY - startPoint.y,
      ) > 10) {
        window.clearTimeout(holdTimer);
      }
      updateDrag(event);
    });
    node.addEventListener("pointerup", event => finishDrag(event));
    node.addEventListener("pointercancel", event => finishDrag(event, true));
    node.addEventListener("lostpointercapture", () => {
      if (dragging) finishDrag(null, true);
      else window.clearTimeout(holdTimer);
    });
  });
}
