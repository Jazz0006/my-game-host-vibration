import { io } from "socket.io-client";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const host = io(baseUrl, { transports: ["websocket"] });
const player = io(baseUrl, { transports: ["websocket"] });

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
    const handler = payload => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, result) => {
      if (error) return reject(error);
      if (!result?.ok) return reject(new Error(result?.message || `${event} failed`));
      resolve(result);
    });
  });
}

try {
  await Promise.all([waitFor(host, "connect"), waitFor(player, "connect")]);
  const room = await emitAck(host, "host:create-room", { name: "测试房主" });
  const joined = await emitAck(player, "player:join-room", { roomId: room.roomId, name: "测试玩家" });

  const promptReceived = waitFor(player, "player:test-prompt");
  await emitAck(host, "host:send-test-prompt", { targetPlayerId: joined.playerId });
  const prompt = await promptReceived;
  await emitAck(player, "player:ack-test-prompt", { promptId: prompt.promptId });

  const submittedState = waitFor(
    host,
    "room:state",
    state => state.testPrompt?.status === "submitted",
  );
  await emitAck(player, "player:submit-test-choice", {
    promptId: prompt.promptId,
    choice: "选项一",
  });
  const finalState = await submittedState;

  console.log(`Flow verified: room ${room.roomId}, choice ${finalState.testPrompt.choice}`);
} finally {
  host.disconnect();
  player.disconnect();
}
