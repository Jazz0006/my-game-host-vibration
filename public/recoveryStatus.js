// C4.2 Host-only recovery diagnostics. This script intentionally depends only
// on the existing room:state transport and never receives actor identities or
// secret action payloads.
const hostRecoveryStatusNode = document.getElementById("host-recovery-status");

socket.on("room:state", state => {
  if (!hostRecoveryStatusNode) return;

  const recovery = state?.viewer?.isHost ? state?.game?.recovery : undefined;
  hostRecoveryStatusNode.classList.toggle("hidden", !recovery);
  if (!recovery) return;

  if (recovery.waitingCount === 0) {
    hostRecoveryStatusNode.textContent = "恢复状态：当前无需玩家操作";
    return;
  }

  const pendingLabel = recovery.hasPendingInteraction ? "等待行动" : "等待操作";
  hostRecoveryStatusNode.textContent =
    `恢复状态：${pendingLabel} ${recovery.waitingCount} 人 · ` +
    `在线 ${recovery.onlineWaitingCount} · 离线 ${recovery.offlineWaitingCount}`;
});
