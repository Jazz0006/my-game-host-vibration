const roomInput = document.querySelector("#recovery-test-room");
const codeInput = document.querySelector("#recovery-test-code");
const claimButton = document.querySelector("#recovery-test-claim");
const disconnectButton = document.querySelector("#recovery-test-disconnect");
const status = document.querySelector("#recovery-test-status");

let recoveredSocket = null;
let recoveredSession = null;

function setStatus(message) {
  status.textContent = message;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, result) => {
      if (error) return reject(new Error(`${event} 响应超时`));
      if (!result?.ok) return reject(new Error(result?.message || `${event} 失败`));
      resolve(result);
    });
  });
}

async function connectSocket() {
  const socket = io({
    forceNew: true,
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
  });
  if (socket.connected) return socket;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("恢复测试客户端连接超时")), 5000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

claimButton.addEventListener("click", async () => {
  const roomId = roomInput.value.trim();
  const recoveryCode = codeInput.value.trim();
  if (!/^\d{4}$/u.test(roomId)) {
    setStatus("请输入正确的 4 位房间号。");
    return;
  }
  if (!recoveryCode) {
    setStatus("请输入房主生成的一次性恢复码。");
    return;
  }

  recoveredSocket?.disconnect();
  recoveredSocket = null;
  recoveredSession = null;
  claimButton.disabled = true;
  disconnectButton.disabled = true;
  setStatus("正在创建新虚拟客户端并接管身份……");

  let socket;
  try {
    socket = await connectSocket();
    const result = await emitAck(socket, "player:claim-identity-recovery", {
      roomId,
      recoveryCode,
    });
    recoveredSocket = socket;
    recoveredSession = {
      roomId: result.roomId,
      playerId: result.playerId,
      resumeToken: result.resumeToken,
    };
    socket.on("disconnect", () => {
      disconnectButton.disabled = true;
    });
    disconnectButton.disabled = false;
    codeInput.value = "";
    setStatus(`接管成功：${result.seat}号 ${result.name}。已获得轮换后的新长期恢复凭证。`);
  } catch (error) {
    socket?.disconnect();
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    claimButton.disabled = false;
  }
});

disconnectButton.addEventListener("click", () => {
  if (!recoveredSocket) return;
  recoveredSocket.disconnect();
  recoveredSocket = null;
  disconnectButton.disabled = true;
  setStatus(recoveredSession
    ? "恢复后的虚拟客户端已断开；可在正式客户端用新 resume token 验证正常 C1 重连。"
    : "恢复测试客户端已断开。");
});

window.addEventListener("beforeunload", () => recoveredSocket?.disconnect());
