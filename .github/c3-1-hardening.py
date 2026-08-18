from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    p.write_text(text.replace(old, new, 1))


facade = Path("src/runtime/node/werewolfCommandFacade.ts")
text = facade.read_text()
old = '''async function runIdempotent(\n  room: RuntimeRoom,\n  scopedCommandId: string,\n  mutation: () => WerewolfCommandOutcome,\n): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {\n  const ledger = commandLedger(room);\n  const execution = await ledger.execute(scopedCommandId, mutation);\n  room.commandReceipts = ledger.entries();\n  return { outcome: execution.result, replayed: execution.replayed };\n}\n'''
new = '''async function runIdempotent(\n  room: RuntimeRoom,\n  scopedCommandId: string,\n  mutation: () => WerewolfCommandOutcome,\n  resetReceiptHistory = false,\n): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {\n  const ledger = commandLedger(room);\n  const execution = await ledger.execute(scopedCommandId, mutation);\n  if (!execution.replayed && resetReceiptHistory) {\n    ledger.restore([{ commandId: scopedCommandId, result: execution.result }]);\n  }\n  room.commandReceipts = ledger.entries();\n  return { outcome: execution.result, replayed: execution.replayed };\n}\n'''
if text.count(old) != 1:
    raise SystemExit("werewolfCommandFacade.ts: runIdempotent block mismatch")
text = text.replace(old, new, 1)
append = '''\n/**\n * Idempotent host lifecycle mutation for start/restart operations that live\n * outside WerewolfCommand. A successful lifecycle reset starts a fresh receipt\n * window while retaining this command's receipt for lost-ACK replay.\n */\nexport function runHostLifecycleMutationIdempotent(\n  room: RuntimeRoom,\n  commandId: string,\n  mutation: () => WerewolfCommandOutcome,\n): Promise<{ outcome: WerewolfCommandOutcome; replayed: boolean }> {\n  return runIdempotent(room, hostCommandKey(commandId), mutation, true);\n}\n'''
if "runHostLifecycleMutationIdempotent" in text:
    raise SystemExit("werewolfCommandFacade.ts: lifecycle helper already exists")
facade.write_text(text.rstrip() + "\n" + append)

replace_once(
    "public/app.js",
    '  emitWithAck("host:start-game", { roleDeck });',
    '  emitCommandWithAck("host:start-game", { roleDeck });',
)
replace_once(
    "public/app.js",
    '  emitWithAck("host:restart-game", {});',
    '  emitCommandWithAck("host:restart-game", {});',
)

replace_once(
    "src/server.ts",
    '''import {\n  runHostCommand,\n  runHostCommandIdempotent,\n  runPlayerCommandIdempotent,\n} from "./runtime/node/werewolfCommandFacade.js";''',
    '''import {\n  runHostCommand,\n  runHostCommandIdempotent,\n  runHostLifecycleMutationIdempotent,\n  runPlayerCommandIdempotent,\n} from "./runtime/node/werewolfCommandFacade.js";''',
)

old_start = '''    socket.on("host:start-game", (data: { roleDeck?: Role[] } | undefined, ack: BasicAck) => {\n      const membership = findMembership(rooms, socket.id);\n      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以开始游戏" });\n      const { room } = membership;\n      if (room.game) return ack({ ok: false, message: "游戏已经开始" });\n      if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {\n        return ack({ ok: false, message: `需要${MIN_PLAYERS}到${MAX_PLAYERS}名玩家才能开始` });\n      }\n      if (room.players.some(player => !player.connected)) {\n        return ack({ ok: false, message: "所有玩家在线后才能开始" });\n      }\n\n      try {\n        const gameConfig = data?.roleDeck\n          ? configFromRoleDeck(room.players.length, data.roleDeck)\n          : configFromPlayerCount(room.players.length);\n        createWerewolfGame(room, gameConfig);\n        delete room.activePrompt;\n        broadcastRoom(io, room);\n        ack({ ok: true });\n      } catch (error) {\n        ruleError(ack, error);\n      }\n    });'''
new_start = '''    socket.on(\n      "host:start-game",\n      async (data: { commandId?: string; roleDeck?: Role[] } | undefined, ack: BasicAck) => {\n        const membership = findMembership(rooms, socket.id);\n        if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以开始游戏" });\n        const commandId = requiredCommandId(data ?? {}, ack);\n        if (!commandId) return;\n        const { room } = membership;\n\n        try {\n          const { replayed } = await runHostLifecycleMutationIdempotent(room, commandId, () => {\n            if (room.game) throw new GameRuleError("游戏已经开始");\n            if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {\n              throw new GameRuleError(`需要${MIN_PLAYERS}到${MAX_PLAYERS}名玩家才能开始`);\n            }\n            if (room.players.some(player => !player.connected)) {\n              throw new GameRuleError("所有玩家在线后才能开始");\n            }\n            const gameConfig = data?.roleDeck\n              ? configFromRoleDeck(room.players.length, data.roleDeck)\n              : configFromPlayerCount(room.players.length);\n            createWerewolfGame(room, gameConfig);\n            delete room.activePrompt;\n            return { kind: "broadcast" };\n          });\n          if (!replayed) broadcastRoom(io, room);\n          ack({ ok: true });\n        } catch (error) {\n          ruleError(ack, error);\n        }\n      },\n    );'''
replace_once("src/server.ts", old_start, new_start)

old_restart = '''    socket.on("host:restart-game", (_data: unknown, ack: BasicAck) => {\n      const membership = findMembership(rooms, socket.id);\n      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以重新开始游戏" });\n      if (!membership.room.game) return ack({ ok: false, message: "游戏尚未开始" });\n      const { room } = membership;\n      const gameConfig = room.gameConfig.playerCount === room.players.length\n        ? room.gameConfig\n        : configFromPlayerCount(room.players.length);\n      createWerewolfGame(room, gameConfig);\n      delete room.activePrompt;\n      broadcastRoom(io, room);\n      ack({ ok: true });\n    });'''
new_restart = '''    socket.on("host:restart-game", async (data: { commandId?: string }, ack: BasicAck) => {\n      const membership = findMembership(rooms, socket.id);\n      if (!membership?.player.isHost) return ack({ ok: false, message: "只有房主可以重新开始游戏" });\n      if (!membership.room.game) return ack({ ok: false, message: "游戏尚未开始" });\n      const commandId = requiredCommandId(data, ack);\n      if (!commandId) return;\n      const { room } = membership;\n      try {\n        const { replayed } = await runHostLifecycleMutationIdempotent(room, commandId, () => {\n          const gameConfig = room.gameConfig.playerCount === room.players.length\n            ? room.gameConfig\n            : configFromPlayerCount(room.players.length);\n          createWerewolfGame(room, gameConfig);\n          delete room.activePrompt;\n          return { kind: "broadcast" };\n        });\n        if (!replayed) broadcastRoom(io, room);\n        ack({ ok: true });\n      } catch (error) {\n        ruleError(ack, error);\n      }\n    });'''
replace_once("src/server.ts", old_restart, new_restart)

test = Path("tests/serverGameFlow.test.ts")
text = test.read_text()
pos = text.rfind("\n});\n")
if pos < 0:
    raise SystemExit("serverGameFlow.test.ts: describe terminator not found")
addition = r'''

  it("dedupes host start/restart lifecycle retries without recreating game state", async () => {
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = sockets[0]!;
    const hostSession = await emitAck<JoinResult>(host, "host:create-room", { name: "房主" });
    for (let index = 1; index < sockets.length; index += 1) {
      await emitAck<JoinResult>(sockets[index]!, "player:join-room", {
        roomId: hostSession.roomId,
        name: `玩家${index + 1}`,
      });
    }

    const roleViews = sockets.map(socket =>
      waitFor<GameView>(socket, "player:game-state", view => view.mode === "role_reveal"),
    );
    expect(await emitAck<{ ok: boolean }>(host, "host:start-game", {
      commandId: "start-game-retry",
    })).toEqual({ ok: true });
    await Promise.all(roleViews);

    const room = game.rooms.get(hostSession.roomId)!;
    const firstStartActionId = room.game?.actionId;
    const firstStartRoles = JSON.stringify(room.game?.roles);
    expect(await emitAck<{ ok: boolean }>(host, "host:start-game", {
      commandId: "start-game-retry",
    })).toEqual({ ok: true });
    expect(room.game?.actionId).toBe(firstStartActionId);
    expect(JSON.stringify(room.game?.roles)).toBe(firstStartRoles);

    expect(await emitAck<{ ok: boolean }>(host, "host:restart-game", {
      commandId: "restart-game-retry",
    })).toEqual({ ok: true });
    const firstRestartActionId = room.game?.actionId;
    const firstRestartRoles = JSON.stringify(room.game?.roles);
    expect(await emitAck<{ ok: boolean }>(host, "host:restart-game", {
      commandId: "restart-game-retry",
    })).toEqual({ ok: true });
    expect(room.game?.actionId).toBe(firstRestartActionId);
    expect(JSON.stringify(room.game?.roles)).toBe(firstRestartRoles);
    expect(room.commandReceipts).toEqual([
      { commandId: "host:restart-game-retry", result: { kind: "broadcast" } },
    ]);
  });
'''
test.write_text(text[:pos] + addition + text[pos:])

roadmap = Path("开发计划_V4_架构验证后实施路线.md")
text = roadmap.read_text()
start = text.index("## 2. 当前主分支基线")
end = text.index("\n---\n\n## 3. 已完成的架构验证", start)
replacement = '''## 2. 当前主分支基线\n\n截至 2026-08-18：\n\n```text\nmain\n└── C3.1 Explicit Socket Command Wiring 已合并\n```\n\n已完成并合并：\n\n```text\nPR #17  post-B5.1 Hunter target guard hotfix\nPR #18  C1 Rejoin Identity Contract\nPR #19  C2 Room Snapshot Contract\nPR #20  C3 Idempotent Commands\nC3.1    Explicit Socket Command Wiring + lifecycle hardening\n```\n\nPR #21 的 middleware + AsyncLocalStorage 实验方案仍保持关闭且未合并；正式 C3.1 采用显式 transport commandId，不依赖隐式 Node runtime context。\n\n当前下一步：**C4 Host Recovery**。\n'''
text = text[:start] + replacement + text[end:]
old_heading = "## 7. 当前下一步 — C3.1 Explicit Socket Command Wiring"
if old_heading in text:
    next_section = text.find("\n---\n\n## 8.", text.index(old_heading))
    if next_section < 0:
        raise SystemExit("roadmap: could not locate end of C3.1 section")
    c31 = '''## 7. C3.1 — Explicit Socket Command Wiring ✅\n\n已完成：\n\n- Web 客户端每个用户意图生成显式 `commandId`；\n- Socket.IO 自动 timeout retry 复用同一个 `commandId`；\n- game mutation handler 显式接收 `commandId`；\n- player/host command 进入 C3 idempotent facade；\n- replayed command 不重复 broadcast、`afterNightAction`、投票结算或其他 secondary side effects；\n- `host:start-game` / `host:restart-game` lifecycle mutation 同样纳入幂等边界；\n- lifecycle reset 后清理旧局 receipt，但保留当前 lifecycle command receipt，以支持 lost-ACK replay；\n- transport integration tests 覆盖 stable actor dedupe、missing commandId 和 lifecycle retry。\n\n正式架构保持：\n\n```text\nClient commandId\n  ↓\nSocket.IO handler\n  ↓\nRuntime idempotency boundary\n  ↓\nGame/lifecycle mutation\n```\n\n不采用 middleware、AsyncLocalStorage 或推导式 fallback commandId。\n'''
    text = text[:text.index(old_heading)] + c31 + text[next_section:]
roadmap.write_text(text)
