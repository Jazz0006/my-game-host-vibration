# 多游戏自动主持系统

面向线下面对面社交推理游戏的自动主持平台。共享 Room Runtime / ClientSession / Cloudflare authority 负责身份、断线恢复、房间与实时通信；具体游戏由独立 GameModule 和 game-specific 微信薄壳承载。当前已验证狼人杀，下一 production-game 方向为 Blood on the Clocktower。

## 当前权威文档

开发时按以下顺序理解项目状态：

- [开发计划 V5：客户端运行时与网络韧性实施路线](./开发计划_V5_客户端运行时与网络韧性实施路线.md) — **当前进度、当前阶段、下一实施切片的执行基线**；
- [长期架构与 Durable Objects 迁移设计 V4](./长期架构与DurableObjects迁移设计_V4.md) — 长期平台边界、ClientSession、Cloudflare、多客户端和 BotC 方向；
- [AGENTS.md](./AGENTS.md) — AI/自动化开发的项目级规范与 ownership 约束。

旧的 `开发计划_V4_架构验证后实施路线.md` 与 `长期架构与DurableObjects迁移设计_V3.md` 仅保留历史参考价值，不再决定当前开发顺序。

## 当前开发状态

截至 2026-09-30，主线阶段状态：

```text
C1–C4 / D1–D5 / E1–E3 / W3D3 platform foundation ✅
MG0    Second-game admission hardening              COMPLETE ✅
B0A–B0B3 BotC module / setup contract / sequencing COMPLETE ✅
B0C1–B0C3A rules-information foundations           CHECKPOINTED ✅
SIM0   Simulator Lab V2 foundation                  ← CURRENT / NEXT
PV0–PV7 BotC Playable Vertical Slice                PLANNED
B0C3B+ deeper Storyteller Recommendation            deferred as mainline
W3E+   Production Web Cloudflare cutover            deferred / not a BotC prerequisite
R1     Reliability Hardening / Effect Outbox        risk-driven
```

HEAD、working tree、remote、PR/CI 都是可变事实，不在 README 固化具体 commit；开始开发前必须重新查询 live state。

## 当前技术栈

- Node.js + TypeScript
- Express + Socket.IO（当前 legacy/production Web baseline）
- Cloudflare Workers + Durable Objects + Hibernation WebSocket
- shared ClientSession / Raw WebSocket client runtime
- Native WeChat thin-client shell/build pipeline
- 静态 Web 玩家端
- Vitest

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，健康检查：

```text
http://localhost:3000/health
```

如果 3000 端口已占用，可设置 `PORT` 后启动。

PowerShell 示例：

```powershell
$env:PORT=3001
npm.cmd run dev
```

## 质量检查

每个 PR 合并前必须运行：

```bash
npm run typecheck
npm test

# 单独验证微信开发者工具 runtime
npm run build:wechat
```

对于 reconnect、snapshot、command idempotency 和秘密信息边界，优先增加 contract / integration regression tests，而不是只修改实现。

## 当前可靠性能力

### Stable player identity

玩家身份已经与 Socket.IO 连接分离。创建/加入房间后，客户端保存：

```text
roomId
playerId
resumeToken
```

重新连接时调用：

```text
player:resume { roomId, playerId, resumeToken }
```

新 socket 可以恢复原 player、座位和 host 权限；旧连接会被替换。

### Authoritative room snapshot

房间恢复合同已经包含：

```text
revision
room metadata
membership
game config/state
ruleState
pendingInteraction
command receipts
```

Socket runtime 字段和 plaintext resume token 不进入持久化 snapshot；private view 由服务器根据 playerId 重建。

### Stable client protocol / runtime

生产狼人杀 gameplay command 已全部收敛到稳定协议边界：

```text
UI intention
→ ClientSession / ClientRealtimeTransport
→ client:command + commandId
→ Node / Cloudflare protocol adapter
→ shared authoritative Werewolf runtime
```

private authoritative PlayerView 通过 `client:state` 同步；transient effect/lifecycle 通过 `client:event` 传递。E2 已锁定 `raw production Werewolf game commands = 0`。E3.2a–E3.5 已建立微信 ticket/Raw WS、reconnect、same-commandId retry 与 native effects；E3.6 进一步加入 transport-neutral public room projection、Cloudflare start/restart lifecycle、next-actor action alert，以及微信 credential storage/lifecycle/native composition/minimal page-controller。fake-`wx` vertical test 已跑通 lobby → command → effect → background reconnect。E3.7A 已提供可直接导入微信开发者工具的 `miniprogram/` shell，以及 TS7 bundler-mode typecheck + esbuild CommonJS runtime build；E3.7B 已在真实 Developer Tools + 手机上完成 production create/join、双端 authoritative push、foreground/background、飞行模式断网恢复、stored-session 恢复与 heavy vibration capability 验收。W3D3 已将一次性 identity-recovery grant、失败尝试限制和 resume credential rotation 收敛到 game-neutral shared owner，并在 Cloudflare DO storage 中持久化；恢复后旧 resume token 以及用旧 credential 签发但尚未消费的 WebSocket ticket 都不能继续接管会话。MG0A 已加入 `werewolf | botc` GameCatalog admission seam；create/join 均由客户端产品固定 gameType，错误游戏客户端不能加入另一类房间。MG0B1 进一步让 BotC lobby 复用同一 Cloudflare ticket / Hibernation WebSocket / sync / reconnect / room-management 路径；MG0B2 再把具体游戏 command/lifecycle/recovery/timeout 编排移出 shared Raw WebSocket bridge，改由 gameType registry 选择 game-specific handler。MG0C 已把 Room Owner 与 Game Moderator 拆为独立 authority：owner 负责房间管理与 recovery，`Automatic | Human(playerId)` moderator assignment 独立持久化；只有 Human Moderator 获得 secret moderator view，且不计入实际玩家/角色分配，Automatic 模式下 owner 仅保留当前 Werewolf 控制入口而不获得 secret view。stale-generation fencing 继续由专门自动化测试覆盖。Room management 与 Moderator assignment 已 authoritative；Ready 与拖动排序仍属于后续 lobby-command/UI slices。2026-09-29 产品方向调整后，微信不再在同一小程序 Lobby 中切换游戏；`骏骏桌游-狼人` 与 `骏骏桌游-血染` 作为两个 game-specific 薄壳共享同一 ClientSession / transport / reconnect / backend，房间在创建时固定 gameType。

## 多玩家模拟器

先启动服务器，再在另一个终端运行：

```bash
npm run simulate
```

可指定人数或服务器地址：

```bash
npm run simulate -- --players 12 --url http://127.0.0.1:3001
```

## 对局实验室

开发环境启动后可访问：

```text
http://localhost:3000/dev/lab
```

当 `NODE_ENV=production` 时，`/dev/lab` 和实验室静态资源不会开放。

当前 `/dev/lab` 仍是早期 Node/Socket.IO 狼人杀实验室。SIM-0 将其收敛为 Simulator Lab V2：基于当前 TestRoomClient / ClientSession / production projection seams，提供一个接近真实手机客户端的 viewer、N 个简化虚拟玩家和开发期 Storyteller/debug inspector。正常开发默认不需要真机。

## 长期产品边界

- 狼人杀已验证当前平台基础；W3D3 与 MG0A–MG0D 已完成；BotC 已具备 B0A–B0B3 与 B0C1–B0C3A 后端基础，当前优先级转为 Simulator-first playable vertical slice，而不是继续让推荐算法深度领先于真实客户端可玩性；
- 手机只承担身份、秘密信息、夜间行动、提醒和少量管理；
- 讨论、发言和社交推理仍在线下完成；
- 断线、熄屏、切 App 和网络切换视为正常生命周期；
- Room Owner 是房间管理/Recovery Controller，不等同于 Game Moderator/Storyteller；
- BotC 真人说书人可以获得游戏所需秘密视图，但 Room Owner 不会自动获得秘密上帝视角；
- 平台核心不硬编码狼人杀或 BotC 具体角色；
- 微信发布采用两个 game-specific thin-client shells，共享一套客户端内核和 Cloudflare backend；
- BotC 自动说书人推荐保持为独立 recommendation/intelligence layer，不进入 Room Runtime 核心。
