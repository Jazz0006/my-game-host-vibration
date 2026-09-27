# 无法官狼人杀助手

面向线下面杀的自动主持系统。玩家在同一房间面对面交流，每人使用自己的手机接收私密身份、夜间行动和震动提醒；系统负责自动主持，因此不需要牺牲一名玩家担任真人法官。

## 当前权威文档

开发时按以下顺序理解项目状态：

- [开发计划 V5：客户端运行时与网络韧性实施路线](./开发计划_V5_客户端运行时与网络韧性实施路线.md) — **当前进度、当前阶段、下一实施切片的执行基线**；
- [长期架构与 Durable Objects 迁移设计 V4](./长期架构与DurableObjects迁移设计_V4.md) — 长期平台边界、ClientSession、Cloudflare、多客户端和 BotC 方向；
- [AGENTS.md](./AGENTS.md) — AI/自动化开发的项目级规范与 ownership 约束。

旧的 `开发计划_V4_架构验证后实施路线.md` 与 `长期架构与DurableObjects迁移设计_V3.md` 仅保留历史参考价值，不再决定当前开发顺序。

## 当前开发状态

截至 2026-09-27，主线阶段状态：

```text
C1–C4  Reconnect / Recovery                     ✅
D1–D5  Cloudflare / Durable Objects foundation ✅
E1     Client Protocol Boundary                ✅
E2.1   Web Command Transport Adapter           ✅
E2.2   Client Runtime / Connection FSM         ✅
E2.3   Legacy Realtime Boundary Contraction    ✅

E3.1   WeChat transport/runtime boundary audit ← NEXT
R1     Reliability Hardening / Effect Outbox
Cloudflare production cutover + real-device validation
BotC production expansion
```

最近确认的远端 `main` HEAD：

```text
71fc3238e3290c131abd2b0776fe25972d5774e2
```

HEAD、working tree、PR/CI 都是可变事实，开始开发前仍必须重新查询 live state。

## 当前技术栈

- Node.js + TypeScript
- Express
- Socket.IO
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

private authoritative PlayerView 通过 `client:state` 同步；transient effect/lifecycle 通过 `client:event` 传递。E2 已锁定 `raw production Werewolf game commands = 0`，下一阶段用微信客户端验证同一协议和 ClientSession 模型是否真正可跨平台复用。

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

## 长期产品边界

- 当前正式交付目标仍是线下面对面狼人杀自动主持；
- 手机只承担身份、秘密信息、夜间行动、提醒和少量管理；
- 讨论、发言和社交推理仍在线下完成；
- 断线、熄屏、切 App 和网络切换视为正常生命周期；
- 房主是 Recovery Controller，不是拥有秘密上帝视角的真人法官；
- 平台核心不硬编码狼人杀具体角色；
- 后续目标包括 Cloudflare Durable Objects、微信小程序和 Blood on the Clocktower；
- BotC 自动说书人推荐保持为独立 recommendation layer，不进入 Room Runtime 核心。
