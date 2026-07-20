import { io } from "socket.io-client";

const DEFAULT_URL = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const TIMEOUT_MS = 5000;

function readArguments(argv) {
  const options = { players: 8, url: DEFAULT_URL, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--players") {
      options.players = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--url") {
      options.url = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`未知参数：${argument}`);
  }

  if (!Number.isInteger(options.players) || options.players < 2 || options.players > 20) {
    throw new Error("--players 必须是 2 到 20 之间的整数（包含房主）");
  }

  if (!options.url) throw new Error("--url 不能为空");
  return options;
}

function printHelp() {
  console.log(`多玩家模拟器

用法：
  npm.cmd run simulate
  npm.cmd run simulate -- --players 8 --url http://127.0.0.1:3001

参数：
  --players <数量>  总人数，包含房主，范围 2-20，默认 8
  --url <地址>      已启动的游戏服务器，默认使用 BASE_URL 或 ${DEFAULT_URL}
  --help            显示帮助`);
}

function createClient(url) {
  return io(url, {
    transports: ["websocket"],
    reconnection: false,
    timeout: TIMEOUT_MS,
  });
}

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`等待事件超时：${event}`));
    }, TIMEOUT_MS);

    const handler = payload => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
  });
}

function waitForConnection(socket, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 连接服务器超时`)), TIMEOUT_MS);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once("connect_error", error => {
      clearTimeout(timer);
      reject(new Error(`${label} 连接失败：${error.message}`));
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, payload, (error, result) => {
      if (error) return reject(new Error(`${event} 响应超时`));
      if (!result?.ok) return reject(new Error(result?.message || `${event} 执行失败`));
      resolve(result);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`验证失败：${message}`);
}

async function runSimulation(options) {
  const host = createClient(options.url);
  const bots = Array.from({ length: options.players - 1 }, (_, index) => ({
    name: `机器人${index + 2}号`,
    socket: createClient(options.url),
    playerId: "",
    expectedPromptId: "",
    receivedPromptIds: [],
  }));
  const allSockets = [host, ...bots.map(bot => bot.socket)];
  const hostPromptIds = [];
  host.on("player:test-prompt", prompt => hostPromptIds.push(prompt.promptId));

  for (const bot of bots) {
    bot.socket.on("player:test-prompt", prompt => bot.receivedPromptIds.push(prompt.promptId));
  }

  try {
    console.log(`[1/4] 连接 ${options.players} 个客户端：${options.url}`);
    await Promise.all([
      waitForConnection(host, "房主"),
      ...bots.map(bot => waitForConnection(bot.socket, bot.name)),
    ]);

    console.log("[2/4] 创建房间并加入机器人");
    const room = await emitAck(host, "host:create-room", { name: "模拟房主" });
    for (const bot of bots) {
      const joined = await emitAck(bot.socket, "player:join-room", {
        roomId: room.roomId,
        name: bot.name,
      });
      bot.playerId = joined.playerId;
    }
    console.log(`      房间 ${room.roomId}，共 ${options.players} 人`);

    console.log("[3/4] 逐个验证定向提醒、确认和提交");
    for (let index = 0; index < bots.length; index += 1) {
      const bot = bots[index];
      const promptReceived = waitFor(bot.socket, "player:test-prompt");

      await emitAck(host, "host:send-test-prompt", { targetPlayerId: bot.playerId });
      const prompt = await promptReceived;
      bot.expectedPromptId = prompt.promptId;

      const acknowledgedState = waitFor(
        host,
        "room:state",
        state => state.testPrompt?.id === prompt.promptId && state.testPrompt.status === "acknowledged",
      );
      await emitAck(bot.socket, "player:ack-test-prompt", { promptId: prompt.promptId });
      await acknowledgedState;

      const choice = index % 2 === 0 ? "选项一" : "选项二";
      const submittedState = waitFor(
        host,
        "room:state",
        state => state.testPrompt?.id === prompt.promptId && state.testPrompt.status === "submitted",
      );
      await emitAck(bot.socket, "player:submit-test-choice", {
        promptId: prompt.promptId,
        choice,
      });
      const finalState = await submittedState;
      assert(finalState.testPrompt.choice === choice, `${bot.name} 的提交结果不一致`);
      console.log(`      ${bot.name}：收到 -> 确认 -> 提交 ${choice}`);
    }

    console.log("[4/4] 检查私密提醒是否发送给错误客户端");
    assert(hostPromptIds.length === 0, "房主收到了玩家私密提醒");
    for (const bot of bots) {
      assert(bot.receivedPromptIds.length === 1, `${bot.name} 收到 ${bot.receivedPromptIds.length} 次提醒，预期 1 次`);
      assert(bot.receivedPromptIds[0] === bot.expectedPromptId, `${bot.name} 收到了其他玩家的提醒`);
    }

    console.log(`\n模拟成功：${options.players} 人房间，${bots.length} 次私密提醒全部通过。`);
  } finally {
    for (const socket of allSockets) socket.disconnect();
  }
}

try {
  const options = readArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    await runSimulation(options);
  }
} catch (error) {
  console.error(`\n模拟失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
