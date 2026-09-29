# 无法官桌游主持平台：Cloudflare Durable Objects 长期架构与客户端运行时设计 V4

> 项目：`Jazz0006/my-game-host-vibration`  
> 主分支：`main`  
> 当前系统：Node.js + TypeScript + Express + Socket.IO + Web 客户端  
> 目标平台：Cloudflare Workers + Durable Objects + Web / game-specific 微信小程序薄壳；共享平台同时承载 Werewolf 与 Blood on the Clocktower  
> 参考实现：`Jazz0006/WerewolfGameJudge`（fork，自 `olveryu/WerewolfGameJudge`）  
> 文档版本：V4  
> 日期：2026-08-19  
> 最近同步：2026-09-29

> 当前 milestone / 下一步以 `开发计划_V5_客户端运行时与网络韧性实施路线.md` 为准。本文负责长期架构；其中 E2.2 / E2.3 的实施拆分保留为历史设计记录，不应覆盖 V5 的当前阶段状态。

---

# 1. 文档定位

本文件取代 `长期架构与DurableObjects迁移设计_V3.md`，作为后续长期架构设计基线。

V4 不推翻已经完成并通过 CI 的 C1–E2.1 基础，而是在再次审计 WerewolfGameJudge 后，对 **客户端运行时、连接恢复、状态同步、实时副作用和多客户端路线**做进一步对齐。

核心结论：

> **服务端权威状态、命令幂等、Durable Object 房间模型和多客户端协议方向保持不变。Client Session / Connection FSM / Realtime Transport 边界已在 E2 完成；当前执行阶段进入 E3 第二客户端验证。**

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
5. Web 与微信客户端在共享协议/恢复语义上一致；
6. 狼人杀已验证平台基础，下一 production game 立即进入 BotC；
7. 微信发布采用按游戏拆分的薄壳产品，共享同一客户端内核与后端 authority。

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
  connect(credentials, generation): void;
  disconnect(generation): void;
  synchronize(credentials, generation): Promise<AuthoritativeStateDelivery>;
  send(message): Promise<unknown>;
  setHandlers(...): void;
}
```

Transport 负责：

- transport URL / ticket；
- 在 socket open 前使用调用方提供的 session credentials 完成必要的 ticket/auth exchange；
- socket create / destroy；
- wire parser；
- open / close / error；
- state/event message delivery。

E3.1 审计确认：transport 必须在建立 Raw WebSocket 之前获得足够的 credential context。E3.2a 已将 E2 的 `connect(generation)` 硬化为 `connect(credentials, generation)`。persistent credential storage 仍由 platform composition/storage adapter 拥有，transport 只为当前连接使用 credentials。异步 ticket exchange 由 transport 内部启动，并通过 generation-tagged `onOpen/onError` 回报结果，因此 connect 本身保持 listener-driven `void` contract。现有 `synchronize(credentials, generation)` 先保留，等第二种真实 transport 落地后再判断是否值得收敛签名。

E3.2b 已建立 Raw WebSocket stable wire：

```text
client -> server
  request { wireVersion, requestId, operation: sync | command, ... }

server -> client
  response { requestId, ok, result | error }
  state    { revision, envelope: ClientStateEnvelope }
  event    { envelope: ClientRealtimeEventEnvelope }
  error    { code, requestId? }
```

关键规则：

- `wireVersion` 属于 Raw WS framing；内层 `protocolVersion` 仍属于稳定 client protocol；
- `requestId` 只做请求/ACK correlation，不承担命令幂等；
- `commandId` 继续是 command retry / idempotency identity；
- E3.4 command retry 每次必须换新的 `requestId`，但必须保持同一 `commandId`；
- retry 只针对 bounded transport-level timeout/send failure；application `ok:false` 不自动重试；
- stable player identity 来自 ticket 绑定后的 Hibernation WebSocket attachment/tag，不在每个 frame 重发 `resumeToken`；
- malformed wire traffic 使用 `error` frame；可解析的 application request failure 使用 correlated `response { ok:false }`；
- authoritative state push 使用 persisted RoomSnapshot revision；
- E3.6 sync 必须同时返回 private PlayerView + transport-neutral public room projection；两者共享 revision 但进入客户端不同 state channel；
- realtime `event` frame 只定义 delivery contract；E3.6 仅补 next-active-actor action-alert，不复制 Node 全部 effect orchestration。

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
Cloudflare Raw WS wire      — Durable Object stable framing
WeChatRealtimeTransport     — 微信 native WebSocket ✅ minimal adapter
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

E3.6 将 public room projection 与 private PlayerView 明确分离：

```text
RoomSnapshot
  ├─ public ClientRoomProjection
  │    roomId / gameType / viewer / players / gameStarted
  │    no resumeTokenHash / socket/runtime fields
  │
  └─ private PlayerView
       role / actionable secret information
```

`ClientSession` 为两者维护独立 revision/generation snapshots。微信 sync 必须同时获得两类 envelope 后才完成最小 native UI 所需的数据闭环；Web 现有 raw `room:state` 暂不迁移。

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

E3.3 增加了 transport request failure 的可恢复分类：

```text
retryable transport request failure
  -> transportUnavailable
  -> Disconnected + closeTransport
  -> reconnect()
  -> new generation + authoritative sync

protocol / identity failure
  -> Failed
  -> fail closed
```

reconnectable 路径包括两类 transport-level failure：socket/ticket network unavailable 直接走 transport close/unavailable；correlated request timeout/send failure 则使用 `ClientTransportRequestError(..., retryable=true)`。非法 ticket credentials、非法 PlayerView、session mismatch、malformed protocol 仍保持 Failed。

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
  ├─ WeChatVibrationCapability ✅
  ├─ WeChatAudioCapability ✅
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

> 微信客户端正式大厅/方桌 UX 以 `docs/微信客户端大厅与方桌_UI实施基线_2026-09-28.md` 为实现标准；该文档只拥有入口页、Lobby、通用方桌、主持位与房间管理 UX，不覆盖本章的 runtime / protocol ownership。

微信产品不再采用“一个小程序内选择多个游戏”的发布形态，而采用两个 game-specific thin-client shells（工作名 `骏骏桌游-狼人` / `骏骏桌游-血染`）。两者不是两套 runtime：

```text
骏骏桌游-狼人 ─┐
                ├─> shared WeChat client/runtime
骏骏桌游-血染 ─┘          ↓
                    shared client protocol
                           ↓
                   Cloudflare WebSocket
                           ↓
                  GameRoom Durable Object
                           ↓
                       GameCatalog
                     /             \
                Werewolf           BotC
```

每个产品壳在创建房间时固定 `gameType`。Lobby 不承担跨游戏切换，也不承担房间 gameType 迁移。

微信客户端只实现：

- 页面显示；
- 用户输入；
- ClientSession；
- command protocol；
- realtime transport；
- vibration / semantic audio platform effects；
- lifecycle；
- reconnect。

E3.5 已证明 effect adapter 只消费稳定 `client:event`：vibration pattern 在平台层近似为 short/long pulse，semantic audio cue 映射到 composition 提供的 source；unsupported capability 或 native failure 都是 best-effort no-op。

E3.6 已建立 native composition root：
- `WeChatSessionCredentialStore` owns local reconnect credentials；
- `WeChatSessionLifecycle` owns hide/show recovery；
- `WeChatNativeClient` 组合 transport/session/effects/storage/lifecycle，并成为唯一允许绑定全局 `wx` 的 concrete owner；
- `WeChatMinimalPageController` 只把 view-model 交给页面，并转发用户 intention；
- fake-`wx` vertical slice 已证明 lobby/start command/night action/effect/background reconnect contract，真实开发者工具/真机行为留到 E3.7。

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

E3.2c 已验证微信 adapter 遵守该边界：`resumeToken` 只进入 authenticated ticket HTTP exchange；native WebSocket URL 只携带 one-time ticket。微信 platform capability 通过注入的 `request/connectSocket` contract 提供，不要求 shared runtime 直接引用全局 `wx`。

E3.7B 进一步补齐首次身份 bootstrap：`POST /rooms` / `POST /rooms/:roomCode/join` 只负责创建 authoritative membership 并把一次性的 plaintext `resumeToken` 交给对应客户端；Durable Object snapshot 只保存 token hash。微信 `WeChatRoomBootstrapClient` 是 HTTP adapter，成功后把 credentials 交给同一个 `WeChatNativeClient -> ClientSession` runtime。内部 snapshot persistence endpoint 不属于 public Worker API，不能作为客户端读写房间状态的旁路。

---

# 19. 多游戏平台边界

WerewolfGameJudge 的 game catalog 验证了 registry 模式适合多游戏平台。2026-09-29 起 BotC 已成为下一 production-game 方向，因此这一边界从未来规划升级为近期实施约束。

MG0 收敛为最小：

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
Moderator/StorytellerView
PublicView
PendingInteraction
Effect
```

Room Owner 是房间管理/恢复权限，不等同于 Game Moderator/Storyteller。该边界已在 MG0C 落地为持久化 `Automatic | Human(playerId)` moderator assignment：Room Owner 保留房间管理与 recovery，Human Moderator 获得 game-control / secret moderator view 且不计入实际游戏参与者；Automatic 模式下当前 Werewolf 仍允许 Owner 作为控制入口，但不会因此获得秘密 moderator view。尤其在 BotC 中，真人说书人可以获得完整秘密魔典视图，而 Room Owner 不会自动获得秘密信息。

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
E2.2 Client Runtime / Connection FSM ✅
        ↓
E2.3 Legacy Realtime Boundary Contraction ✅
        ↓
E3 Native WeChat Thin Client
  ├─ E3.1 transport / ClientSession boundary audit ✅
  ├─ E3.2a pre-connect credential / ticket seam ✅
  ├─ E3.2b Raw WebSocket stable wire ✅
  ├─ E3.2c minimal WeChat transport ✅
  ├─ E3.3 state sync + reconnect PoC ✅
  ├─ E3.4 command ACK / retry PoC ✅
  ├─ E3.5 vibration / audio adapter ✅
  ├─ E3.6 minimal native vertical slice ✅
  ├─ E3.7A Developer Tools shell + native runtime build ✅
  └─ E3.7B Developer Tools + real-device lifecycle validation ✅
        ↓
W3D3 Game-neutral identity recovery ✅
        ↓
MG0 Second-game admission hardening COMPLETE ✅
  ├─ MG0A GameCatalog / fixed admission ✅
  ├─ MG0B game-neutral realtime + command dispatch ✅
  ├─ MG0C Room Owner / Game Moderator split ✅
  └─ MG0D game-specific WeChat product shells ✅
        ↓
BotC / Trouble Brewing Production Expansion
  ├─ B0A module + setup/view contracts ✅
  ├─ B0B first-night / night sequencing ← CURRENT
  │   ├─ B0B1 canonical order + first-night progression ✅
  │   └─ B0B2 later-night dynamic eligibility / progression ← NEXT
  └─ B0C+ information / storyteller intelligence slices
        ↓
Production Web cutover / Reliability hardening — deferred, risk-driven
```

E2 与 E3.1–E3.7B 已完成，包括第二客户端边界、Raw WebSocket、reconnect/state-sync、same-commandId retry、微信 effects、public room projection、Cloudflare lifecycle、native composition、Developer Tools 工程壳/构建链与真实设备 lifecycle 验收。后续 W3D3 与 MG0A–MG0D 也已完成：identity recovery 已 game-neutral，room runtime/command dispatch 已具备第二游戏边界，Owner/Moderator 已拆分，微信发布形态已由一个 shared shell source 生成 `骏骏桌游-狼人` / `骏骏桌游-血染` 两个独立产品工程。当前已进入 BotC / Trouble Brewing production expansion；B0A 已建立真实 BotC GameModule、Trouble Brewing setup contract 与 authoritative views；B0B1 已建立 canonical night order 与 first-night progression，下一步 B0B2 补 later-night dynamic eligibility / progression；Storyteller Intelligence 继续保持为独立层。Production Web cutover 与 Reliability hardening 不再作为 BotC 前置。微信 runtime 继续由 `tsconfig.wechat` 做 bundler-mode typecheck，再由显式 `esbuild` owner 为两个 generated product package 打出 CommonJS runtime bundle；生成产物不成为第二份源码。下方 E2.2 / E2.3 章节保留为已完成阶段的历史设计说明。

---

# 21. E2.2 推荐拆分（历史已完成）

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

# 22. E2.3 目标（历史已完成）

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

大型通用平台能力仍只在真实需求驱动下建设。此前约定的两个关键触发条件现在已经发生：第二个 production client（Native WeChat）已通过真机验证，第二个 production game（BotC）正式开始接入。

因此当前允许且要求进行的通用化仅限 MG0 已暴露的真实责任边界：GameCatalog/game admission、game-neutral room/runtime/recovery、Owner/Moderator 分离，以及共享客户端内核与 game-specific product shell 分离。仍然禁止为了未知角色能力建设大型通用规则 DSL。

原则更新为：

> **只抽第二个真实 game/client 已经证明需要共享的边界；游戏规则和 UI 保持具体。**

---

# 26. 最终目标

长期最终结构：

```text
               Shared Client Protocol
                       |
          +------------+-----------------------+
          |                                    |
      Web Client                      Shared WeChat Runtime
                                              /         \
                               骏骏桌游-狼人   骏骏桌游-血染
          |                                    |
          +--------------------+---------------+
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
