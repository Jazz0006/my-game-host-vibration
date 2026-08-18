# 无法官狼人杀助手

面向线下面杀的自动主持系统。玩家在同一房间面对面交流，每人使用自己的手机接收私密身份、夜间行动和震动提醒；系统负责自动主持，因此不需要牺牲一名玩家担任真人法官。

## 当前正式文档

为了避免旧设计和历史 architecture spike 干扰后续开发，当前工作树只保留两份正式设计文档：

- [开发计划 V4：当前实施路线](./开发计划_V4_架构验证后实施路线.md) — **当前开发进度和下一步工作的唯一执行基线**；
- [长期架构与 Durable Objects 迁移设计 V3](./长期架构与DurableObjects迁移设计_V3.md) — 长期平台边界、Cloudflare、Reconnect、多客户端和 BotC 方向参考。

如果两份文档的“当前进度”描述不同，以开发计划 V4 为准；V3 主要负责长期架构原则。

旧 MVP 设计、已完成的 B3–B5.1 spike 文档和废弃的探索性长期架构 V4 已从当前树移除，需要时可从 Git history 查看。

## 当前开发状态

截至 2026-08-18，主线已完成：

```text
PR #17  post-B5.1 hotfix
PR #18  C1 Rejoin Identity Contract
PR #19  C2 Room Snapshot Contract
PR #20  C3 Idempotent Commands
```

当前 `main` 基线：

```text
2148c18a42a6ce6107b6d713bcc48be37ae86bea
```

下一步：

```text
C3.1 Explicit Socket Command Wiring
→ C4 Host Recovery
→ D1 Cloud Room abstraction
→ Cloudflare Durable Objects
```

之前的 PR #21 middleware + AsyncLocalStorage 方案已关闭且未合并，不是正式设计。C3.1 应在本地/Codex 直接修改 `public/app.js` 和 `src/server.ts`，使用显式 `commandId` transport envelope。

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

### Idempotent command core

C3 已建立 bounded command receipt ledger 和 snapshot recovery。当前下一步 C3.1 是把真实浏览器 / Socket.IO mutation 显式接入：

```text
client commandId
→ Socket.IO handler
→ runPlayerCommandIdempotent / runHostCommandIdempotent
→ game module
```

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
