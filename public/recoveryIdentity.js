let latestRecoveryRoomState = null;

for (const inputId of ["room-input", "recovery-room-input"]) {
  const input = document.getElementById(inputId);
  if (!input) continue;
  input.maxLength = 4;
  input.setAttribute("inputmode", "numeric");
  if (inputId === "room-input") input.placeholder = "4位房间号";
}

const recoveryCodeInput = document.getElementById("recovery-code-input");
if (recoveryCodeInput) {
  recoveryCodeInput.maxLength = 6;
  recoveryCodeInput.setAttribute("inputmode", "numeric");
  recoveryCodeInput.placeholder = "6位恢复码";
}

function recoveryOfflineCandidates(state) {
  if (!state?.viewer?.isHost) return [];
  return state.players.filter(player => !player.isHost && !player.connected);
}

function renderIdentityRecoveryControls(state) {
  latestRecoveryRoomState = state;
  const candidates = recoveryOfflineCandidates(state);
  document.querySelectorAll("[data-open-identity-recovery]").forEach(button => {
    button.classList.toggle("hidden", !state.viewer.isHost);
    button.disabled = candidates.length === 0;
    button.title = candidates.length
      ? "为离线玩家生成5分钟有效的一次性恢复码"
      : "当前没有离线玩家需要恢复身份";
  });

  const select = document.getElementById("identity-recovery-target");
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(...candidates.map(player =>
    new Option(`${player.seat}号 ${player.name}`, player.id)
  ));
  if (candidates.some(player => player.id === previous)) select.value = previous;
}

socket.on("room:state", renderIdentityRecoveryControls);

document.querySelectorAll("[data-open-identity-recovery]").forEach(button => {
  button.addEventListener("click", () => {
    if (!latestRecoveryRoomState?.viewer?.isHost) return;
    renderIdentityRecoveryControls(latestRecoveryRoomState);
    document.getElementById("identity-recovery-code").textContent = "";
    document.getElementById("identity-recovery-error").textContent = "";
    document.getElementById("identity-recovery-dialog").classList.remove("hidden");
  });
});

document.getElementById("cancel-identity-recovery").addEventListener("click", () => {
  document.getElementById("identity-recovery-dialog").classList.add("hidden");
});

document.getElementById("create-identity-recovery").addEventListener("click", () => {
  const targetPlayerId = document.getElementById("identity-recovery-target").value;
  if (!targetPlayerId) {
    document.getElementById("identity-recovery-error").textContent = "请选择一名离线玩家";
    return;
  }
  socket.timeout(5000).emit(
    "host:create-identity-recovery",
    { targetPlayerId },
    (error, result) => {
      const errorNode = document.getElementById("identity-recovery-error");
      const codeNode = document.getElementById("identity-recovery-code");
      if (error) {
        errorNode.textContent = "服务器响应超时，请重试";
        return;
      }
      if (!result?.ok) {
        errorNode.textContent = result?.message || "生成恢复码失败";
        return;
      }
      errorNode.textContent = "";
      codeNode.textContent = `恢复码：${result.recoveryCode}（6位数字 · 5分钟内使用一次）`;
    },
  );
});

document.getElementById("claim-identity-recovery").addEventListener("click", () => {
  const roomId = document.getElementById("recovery-room-input").value.trim();
  const recoveryCode = document.getElementById("recovery-code-input").value.trim();
  const errorNode = document.getElementById("entry-recovery-error");
  if (!/^\d{4}$/u.test(roomId)) {
    errorNode.textContent = "请输入4位房间号";
    return;
  }
  if (!/^\d{6}$/u.test(recoveryCode)) {
    errorNode.textContent = "请输入6位数字恢复码";
    return;
  }

  socket.timeout(5000).emit(
    "player:claim-identity-recovery",
    { roomId, recoveryCode },
    (error, result) => {
      if (error) {
        errorNode.textContent = "服务器响应超时，请重试";
        return;
      }
      if (!result?.ok) {
        errorNode.textContent = result?.message || "恢复身份失败";
        return;
      }
      errorNode.textContent = "";
      saveSession(result);
      enterRoom(result);
    },
  );
});
