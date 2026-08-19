# 无法官桌游主持平台：Cloudflare Durable Objects 长期架构与客户端运行时设计 V4

> 项目：`Jazz0006/my-game-host-vibration`  
> 主分支：`main`  
> 当前系统：Node.js + TypeScript + Express + Socket.IO + Web 客户端  
> 目标平台：Cloudflare Workers + Durable Objects + Web / 微信小程序，多游戏扩展到 Blood on the Clocktower  
> 参考实现：`Jazz0006/WerewolfGameJudge`（fork，自 `olveryu/WerewolfGameJudge`）  
> 文档版本：V4  
> 日期：2026-08-19

---

# 1. 文档定位

本文件取代 `长期架构与DurableObjects迁移设计_V3.md`，作为后续长期架构设计基线。

V4 不推翻已经完成并通过 CI 的 C1–E2.1 基础，而是在再次审计 WerewolfGameJudge 后，对 **客户端运行时、连接恢复、状态同步、实时副作用和多客户端路线**做进一步对齐。

核心结论：

> **服务端权威状态、命令幂等、Durable Object 房间模型和多客户端协议方向保持不变；下一阶段重点不是继续增加 Socket 事件，而是建立稳定的 Client Session / Connection FSM / Realtime Transport 边界。**

---

# 2. 产品边界

本项目面向朋友线下面对面游戏：

- 每名玩家一台手机；
- 讨论、发言、欺骗和社交推理仍在线下完成；
- 手机只承担身份、秘密信息、夜间行动、提醒和少量管理；
- 系统自动主持，不牺牲玩家当法官；
- Host 是异常恢复与房间管理角色，而不是真人上帝视角法官；
- 熄屏、切 App、浏览器暂停、网络切换是正常生命周期，不应被视为异常边缘场景。

优先级：

1. 可靠性；
2. 隐私边界；
3. 低打扰和低操作量；
4. 快速断线恢复；
5. Web 与微信客户端一致行为；
6. 狼人杀先可用，再自然扩展到 BotC。

---

# 3. 已验证的架构基线

截至 2026-08-19，以下路线已完成：

```text
C1–C4   Reconnect / Recovery ✅
D1      Transport-neutral Room Command Runtime ✅
D2.1    Worker + Durable Object Skeleton ✅
D3      Durable Object Snapshot Persistence ✅
D4      Hibernation WebSocket ✅
D5      Node / Cloudflare Authoritative Parity ✅
E1      Client Protocol Boundary ✅
E2.1    Web Command Transport Adapter ✅ — PR #36
```

已经成立的合同包括：

```text
stable playerId
+ resumeToken
+ authoritative RoomSnapshot
+ revision
+ commandId idempotency
+ actionId interaction concurrency
+ private PlayerView
```

这些基础不因 V4 重新设计。

---

# 4. 总体架构

长期结构调整为：

```text
                         UI / Game Screens
                                |
                         WebClientSession
                    /-----------|------------\
                   /            |             \
          CommandSession   StateStore    EffectDispatcher
                |               |               |
        Client Protocol     PlayerView      vibration/audio
                |               |          local presentation
                \---------------|---------------/
                                |
                       Connection Manager
                                |
                         Connection FSM
                                |
                       IRealtimeTransport
                         /             \
                Socket.IO           Raw WebSocket
                  Node             Cloudflare DO
                                     |
                               WeChat native
                                     |
                              wx capability

                                ↑
                     authoritative server room
                                |
                         GameRoom Runtime
                     /----------|-----------\
                Membership   GameModule   Revision
                                |
                          Werewolf / BotC
```

关键改变：

> UI 不直接拥有网络恢复语义；Transport 不直接拥有游戏状态；Realtime Event 不承担恢复后的状态重建。

---

# 5. 对 WerewolfGameJudge 的再次审计结论

## 5.1 直接借鉴的设计思想

以下模式已经在 WerewolfGameJudge 中形成成熟实现，适合借鉴：

- `Connecting -> Syncing -> Connected` 的连接状态区分；
- pure Connection FSM + imperative Connection Manager；
- 独立 `IRealtimeTransport`；
- reconnect exponential backoff + jitter；
- foreground / background / online / offline 生命周期集中处理；
- revision-based authoritative state reconciliation；
- generation 防止旧异步 fetch / reconnect 覆盖新 session；
- command pending / immutable envelope 思路；
- post-commit effect outbox；
- multi-game catalog / registry 思路。

## 5.2 不直接复制的设计

以下设计不作为本项目当前长期默认：

- 强制 JWT / account userId 作为玩家身份；
- 用 WebView 作为微信小程序长期最终形态；
- 把所有实时事件都做 durable replay；
- 立即引入完整 monorepo / game-engine package 体系；
- 立即加入高频 revision polling；
- 为未来 BotC 提前建设大型通用规则 DSL。

## 5.3 我们继续坚持的差异化设计

- room-scoped stable `playerId`；
- `resumeToken` 作为低门槛恢复身份；
- 长期 credential 先换短期一次性 WebSocket ticket；
- `commandId` 与 `actionId` 分离；
- authoritative snapshot / PlayerView 为 reconnect 真相；
- Host recovery privacy-safe；
- event replay 不作为普通房间恢复机制。

---

# 6. Client Session 是下一阶段核心边界

E2.1 已证明浏览器 user intention 可以通过 E1 protocol envelope 进入 Node authoritative runtime。

但 E2.1 的 browser bridge 是迁移 shim，不是最终 API。

当前：

```text
app.js
  -> legacy Werewolf event name
  -> browser bridge
  -> client:command
  -> E1 protocol
```

长期目标：

```text
UI
  -> gameClient / ClientSession semantic command
  -> E1 protocol command
  -> transport
```

因此 UI 最终不应继续把：

```text
player:submit-wolf-target
host:start-night
player:submit-vote
```

视为业务 API。

Legacy event name 只允许存在于迁移适配层和兼容测试中。

---

# 7. Connection FSM

客户端必须明确区分：

```text
Idle
  ↓
Connecting
  ↓
Syncing
  ↓
Connected
```

断线：

```text
Connected
  ↓
Disconnected
  ↓
Reconnecting
  ↓
Syncing
  ↓
Connected
```

严重协议错误：

```text
any active state -> Failed
```

## 7.1 为什么必须有 Syncing

WebSocket / Socket.IO 已重连并不意味着客户端已经恢复正确游戏状态。

例如：

```text
手机熄屏
→ socket 断开
→ 夜间行动推进
→ 手机亮屏
→ socket reconnect
```

此时只有在收到并应用 authoritative PlayerView 后，才允许把客户端标记为 `Connected`。

所以：

> **transport connected != session synchronized**

## 7.2 FSM 职责

FSM 只负责：

- 状态转换；
- retry/backoff decision；
- 产生 side-effect instruction；
- protocol failure -> Failed。

FSM 不负责：

- 创建真实 Socket；
- fetch；
- timer；
- DOM；
- vibration；
- game rule。

这样可以做 exhaustive unit tests。

---

# 8. Connection Manager

Connection Manager 是 FSM 的 imperative shell。

它负责：

- open / close transport；
- reconnect timer；
- exponential backoff + jitter；
- initial authoritative sync；
- foreground / background；
- online / offline；
- stale async generation isolation；
- future ping/pong；
- future optional revision polling。

## 8.1 generation 规则

每次 session bind、reconnect generation、leave/switch room 都递增 generation。

任何异步结果应用前必须满足：

```text
response.generation == currentGeneration
```

旧 reconnect / fetch 即使晚到，也不能覆盖当前 PlayerView。

---

# 9. IRealtimeTransport

长期 transport interface 只暴露原子网络能力。

示意：

```ts
interface IRealtimeTransport {
  connect(...): Promise<void>;
  disconnect(): void;
  send(message: string): boolean;
  setHandlers(...): void;
}
```

Transport 负责：

- transport URL / ticket；
- socket create / destroy；
- wire parser；
- open / close / error；
- state/event message delivery。

Transport 不负责：

- reconnect policy；
- room state；
- command pending state；
- game rule；
- vibration/audio；
- UI lifecycle。

实现：

```text
SocketIoRealtimeTransport   — 当前 Node Web
CloudflareRealtimeTransport — Raw WebSocket / DO
WeChatRealtimeTransport     — 微信 native WebSocket
```

---

# 10. Authoritative State Store

客户端只维护服务器权威 PlayerView 的 mirror，而不是第二套 game engine。

输入来源可以有两个：

```text
command response
realtime state update
```

两者都必须通过同一 revision 规则收敛。

基本规则：

```text
incoming revision > current revision
    -> apply

incoming revision == current revision
    -> duplicate / ignore

incoming revision < current revision
    -> stale / ignore
```

对于同一活跃 transport 若出现无法解释的 revision 倒退、非法 state version 或非法 protocol envelope，应视为 protocol failure，而不是普通业务错误。

客户端 store 不自行推导秘密结果，不自行推进 phase。

---

# 11. Reconnect 合同

Reconnect 继续使用：

```text
roomId
playerId
resumeToken
```

长期流程：

```text
resume credentials
      ↓
authenticate / bind stable player
      ↓
connect transport
      ↓
Syncing
      ↓
fetch / receive authoritative PlayerView
      ↓
revision reconcile
      ↓
Connected
```

普通 reconnect 不要求 replay 历史 realtime events。

原因：

> 已发生的游戏变化应该体现在 authoritative state 中，而不是依赖客户端补收所有历史广播。

---

# 12. Realtime Event 与 Authoritative State 必须分离

消息分两类：

## 12.1 Authoritative state

例如：

- 当前 phase；
- 当前 PlayerView；
- 当前 pending interaction；
- alive/dead；
- 当前 vote 状态；
- revision。

丢失后可通过 snapshot / PlayerView 恢复。

## 12.2 Realtime effect

例如：

- vibration；
- 提示音；
- animation trigger；
- toast；
- 短暂 UI highlight。

这些 effect 不应该反向成为游戏事实来源。

如果 effect 丢失但 authoritative state 已更新，客户端仍必须能够恢复到正确游戏状态。

---

# 13. Effect Dispatcher

ClientSession 把 realtime effect 交给本地 Effect Dispatcher：

```text
protocol event
     ↓
EffectDispatcher
  ├─ WebVibrationCapability
  ├─ WebAudioCapability
  ├─ WeChatVibrationCapability
  └─ Future Native Capability
```

游戏 UI 不直接绑定 transport event name。

例如长期应表达成：

```text
interactionBecameActionable
```

而不是：

```text
socket.on("player:action-alert")
```

---

# 14. Durable Effect：未来 Reliability Hardening

WerewolfGameJudge 的 transactional outbox 很值得借鉴，但不进入当前 E2.2 第一 PR。

理论 failure window：

```text
command committed
state persisted
revision advanced
        ↓
Worker / DO interrupted
        ↓
post-commit notification not delivered
```

未来增加：

```text
state + receipt + effect outbox
       same commit boundary
              ↓
       retryable delivery
```

适用对象：

- 必须最终执行的 server-side post-commit effect；
- 不能仅依赖当前在线 socket 的通知。

不适用对象：

- 所有动画；
- 所有普通震动；
- 所有可从 authoritative state 恢复的 UI 状态。

建议单独阶段：`Reliability Hardening / Effect Outbox`。

---

# 15. Durable User Event：只选择性采用

不建立“所有 realtime event 都永久 replay”的通用事件日志。

只有满足以下条件的用户通知才考虑 durable inbox：

1. 必须最终被特定用户看到；
2. authoritative PlayerView 无法自然表达；
3. 重复投递可以通过 eventId 去重；
4. 有明确 ACK 语义。

普通 reconnect 仍以 authoritative state recovery 为主。

---

# 16. 微信小程序长期路线

WerewolfGameJudge 当前 miniapp 主要是 WebView shell，可作为发布链路 PoC，但不是本项目长期目标。

本项目正式路线：

```text
WeChat native thin client
       ↓
shared client protocol
       ↓
Cloudflare WebSocket
       ↓
GameRoom Durable Object
```

微信客户端只实现：

- 页面显示；
- 用户输入；
- ClientSession；
- command protocol；
- realtime transport；
- `wx` vibration；
- lifecycle；
- reconnect。

不复制：

- Werewolf rules；
- phase machine；
- secret calculation；
- server recovery policy。

WebView 可以作为短期 PoC / 审核验证方案，但必须在文档中明确它不是最终 architecture。

---

# 17. 玩家身份与账号

本项目继续保持低门槛 room-scoped identity：

```text
stable playerId
+ resumeToken
```

未来账号体系如果加入，应为可选上层：

```text
optional Account
      ↓
room player session
```

而不是强制：

```text
Account == Player
```

这样朋友聚会仍可以扫码 / 输入房间号后快速开始。

---

# 18. WebSocket credential

继续保持 D4 已建立的模式：

```text
resumeToken
   ↓
authenticated HTTP exchange
   ↓
short-lived one-time websocket ticket
   ↓
WebSocket upgrade
```

长期 resume credential 不直接放入 WebSocket URL。

---

# 19. 多游戏平台边界

WerewolfGameJudge 的 game catalog 验证了 registry 模式适合多游戏平台。

本项目未来 BotC 阶段可收敛为：

```text
GameCatalog
  ├─ werewolfGameModule
  └─ botcGameModule
```

平台层只理解通用概念：

```text
GameState
GameCommand
PlayerView
HostView
PendingInteraction
Effect
```

不理解：

- 狼人；
- 女巫；
- 预言家；
- 恶魔；
- 爪牙；
- BotC 具体能力。

暂不复制 WerewolfGameJudge 的完整 package / runtime-erased engine 体系。

---

# 20. 推荐后的实施路线

```text
C1–C4 Recovery ✅
        ↓
D1–D5 Cloudflare authoritative foundation ✅
        ↓
E1 Client Protocol Boundary ✅
        ↓
E2.1 Web Command Transport Adapter ✅
        ↓
E2.2 Client Runtime / Connection FSM
        ↓
E2.3 Legacy Realtime Boundary Contraction
        ↓
E3 Native WeChat Thin Client
        ↓
Reliability Hardening
  └─ Post-commit Effect Outbox
        ↓
Cloudflare Production Cutover + Real-device Field Validation
        ↓
BotC Production Expansion
```

---

# 21. E2.2 推荐拆分

为了保持小 PR：

## E2.2a — Client Connection FSM + State Store

只建立：

- pure `ClientConnectionFSM`；
- authoritative `ClientStateStore`；
- revision rules；
- generation / stale async guard；
- tests。

不立即改写生产 reconnect。

## E2.2b — Web ClientSession + Socket.IO Transport

接入：

- `ClientSession`；
- `SocketIoRealtimeTransport`；
- reconnect -> Syncing -> PlayerView -> Connected；
- browser visibility / online lifecycle。

## E2.2c — Realtime Effect Dispatcher

迁移：

- action alert；
- vibration；
- audio；
- game-over / short-lived presentation events。

保证 effect 不承担 authoritative recovery。

---

# 22. E2.3 目标

当 E2.2 稳定后，再逐步减少 legacy Socket.IO application semantics：

- UI 不再直接写 legacy Werewolf event names；
- legacy server handlers 保留一段回滚窗口；
- protocol state / event / reconnect 成为长期 API；
- Cloudflare Raw WebSocket transport 可替换 Node Socket.IO transport；
- 同一 ClientSession 无需理解底层 transport。

---

# 23. Field Validation

Cloudflare production cutover 前必须有真实设备验证，而不能只依赖单元测试。

重点场景：

- iPhone Safari 熄屏 / 解锁；
- Android Chrome 切 App；
- Wi-Fi -> 4G/5G；
- 短时无网；
- Host 与 player 同时重连；
- 同 player 新设备 replacement；
- 夜间 action 正在进行时断线；
- timeout 延长过程中断线；
- Cloudflare DO hibernation / reconstruction；
- 微信小程序前后台切换。

---

# 24. Architecture Guardrails

继续自动测试以下依赖：

- game module 不依赖 client protocol；
- client protocol 不依赖 Node / Cloudflare transport；
- shared client runtime 不依赖具体 Web DOM / 微信 API；
- Socket.IO transport 与 Cloudflare transport 不互相 import；
- vibration/audio capability 不进入 game rule；
- private PlayerView projection 不因 transport 改变；
- reconnect 不依赖 event replay 才能恢复 authoritative state。

---

# 25. 何时不要继续抽象

以下条件出现前，不建设大型通用平台能力：

- 第二个 production game 真正开始接入；
- 第二个 production client 真正开始接入；
- 实际 field test 证明当前简单机制不足；
- 明确重复代码已经形成维护成本。

原则：

> **先用真实狼人杀体验验证抽象，再让 BotC 和微信客户端推动下一次通用化。**

---

# 26. 最终目标

长期最终结构：

```text
               Shared Client Protocol
                       |
          +------------+------------+
          |                         |
      Web Client              WeChat Client
          |                         |
      ClientSession             ClientSession
          |                         |
          +------------+------------+
                       |
                Cloudflare Worker
                       |
               GameRoom Durable Object
                       |
                  Game Catalog
               /               \
          Werewolf             BotC
```

系统必须保证：

> **网络可以中断，客户端可以重启，Transport 可以更换，但房间权威状态、玩家秘密信息和同一个用户意图的语义不能因此改变。**
