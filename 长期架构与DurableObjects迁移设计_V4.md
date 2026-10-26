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

## 19.1 BotC 内部长期 ownership contract

BotC 不能因为 `BotcGameModule` 是平台接入点，就把阵容搜索、规则判定、信息生成和说书人推荐全部塞进同一个模块。长期数据流固定为：

```text
Setup Generation / Setup Contract
        ↓
Canonical Session / Truth
        ↓
Game Engine / BotcGameModule
        ↓
Rules / Information Resolution
        ↓
Recommendation Context Builder
        ↓
Storyteller Recommendation Engine
        ↓
chosen decision
        ↓
Game Engine authoritative commit
```

职责边界：

- **Setup Generation / Setup Contract**：角色/剧本合法性、人数分布、Baron 等 setup mutation、actual/shown identity 合法性，以及以后真正的阵容候选生成。它不推进夜晚，也不决定信息强弱。
- **Canonical Session / Truth**：唯一权威真实状态，包括已接受阵容、死亡、角色变化、白天/夜晚已发生事实等。推荐层只读，不直接写入。
- **Game Engine / GameModule**：负责 phase、command lifecycle、调用各 owner、提交已接受的决策、生成 Player/Moderator/Public projection；它是 orchestration façade，不是所有 BotC 逻辑的最终 owner。
- **Rules / Information Resolution**：负责能力是否合法/如何生效、registration、poison/drunk truth、合法信息候选等确定性或受规则约束的结果。
- **Storyteller Recommendation Engine**：给定明确 decision point 与 required / optional context，对合法候选进行质量排序并给出理由/trace；不得自行改 authoritative state。

2026-09-30 B0B3 前置 ownership audit 已确认：B0A 阶段把 setup normalization 暂存在 `BotcGameModule` 是可接受的过渡，但继续扩张会造成重新耦合。因此从 B0B3 起，Trouble Brewing setup validation 迁到独立 setup owner；night sequencing/progression 也保持为纯 owner，`BotcGameModule` 只编排并持有 canonical session facts。B0C+ 必须继续把 Rules/Information 与 Storyteller Recommendation 分开，而不是把“合法信息生成”和“推荐哪条信息更好”合并成一个 intelligence 大模块。

## 19.2 单一 BotC Session 与唯一提交路径（2026-10-26）

本节固化参考 OfflineBotcHost 后确认的实施标准，不宣称 Session 数据迁移或完整昼夜循环已经实现；当前进度与下一切片仍由 V5 拥有。

**一局只有一个可写的游戏事实聚合、一个语义提交边界。** 在现有 `BotcGameState` / `BotcGameModule` seam 上演进，不在旁边建立第二份可写 GameSession。Session 是游戏状态与已确认记录的统一归属，不要求所有代码集中在一个类或文件，也不要求复制 Android 的有状态类。

1. **同一行为共用提交路径。** 玩家命令、真人说书人选择、自动裁量与必要恢复操作进入同一游戏命令/提交边界；客户端、AI、Simulator、持久化适配器不自行结算或补写游戏事实。不同 transport 可以有各自 adapter，但不得各自实现一套规则或流程控制。
2. **事实变化与记录一起接受。** 一个已确认步骤产生的行动、即时机械结果、已提交告知内容及当前状态必须作为一致的变化接受；Runtime 再把游戏状态、房间 revision 与 command receipt 一起持久化。失败不得留下半个事实或成功回执；重复请求不得重复产生记录，过期交互不得写入当前步骤。`commandId` 留在 Runtime，交互 `actionId` 与历史 `factId/recordId` 不混用。
3. **历史只记录已确认事实。** 行动和告知可以分开存放，但共享唯一全局顺序，不能先分别排序再拼接。预览、未接受建议和 UI 草稿不成为正式记录；已确认历史不因页面返回、重新计算或当前醉毒/生死变化而改写。必要纠错追加明确记录。
4. **游戏真相与玩家可见事实分别表达。** 机械结果按发生时点影响后续步骤；对外公开时点由游戏投影控制，不能因内部死亡已生效就提前暴露夜间秘密。告知记录保留已提交给指定接收者的实际内容，不用真实答案替换假信息，也不从答案反推未记录的登记选择。
5. **网络告知不能照搬离线 Next 语义。** 服务端已提交内容、网络发送、玩家确认是不同事实；发送成功不证明玩家已读。保留现有 authoritative commit → private delivery → recipient acknowledgement 路径，重连重发同一内容；合法的服务端 active interaction/等待确认状态必须可恢复，不能因 Offline Host 不保存 UI pending 就删除它们。
6. **恢复继续使用同一 Session。** 从受支持存档恢复当前权威状态及必要上下文，再进入正常命令路径；不建立独立 recovery game engine。当前值与历史派生索引必须明确归属，正常提交与恢复复用同一必要计算逻辑，不在 JSON decoder 内另写规则。保存当前状态加历史不等于已支持从开局完整重放。
7. **完整记录需区分初始与当前状态。** 引入完整对局记录时保留不可变初始布局，后续角色/生死变化只更新当前状态并追加记录；不能从最终状态猜初始身份。旧存档缺失内容应显式保留缺失语义或限制相应导出，不能伪造完整历史。内部已知事实不必为了史料缺失而全部套用通用未知值模型。
8. **跨项目共享语义，运行时各自负责。** 完整 Session/交换合同若实施，需明确角色 ID、稳定参与者与座位映射、整数精度、版本及缺失值语义；按真实消费者用少量共享样例验证。现有 `TroubleBrewingGameSnapshotV1` 继续是只读语义快照，不自动升级为完整存档。Android AtomicFile、UI 确认流程、AI provider 会话与本项目 DO/Room Runtime 不互相搬运。

## 19.3 文件与结构责任边界

| Owner | 应拥有 | 不应拥有 |
| --- | --- | --- |
| Canonical Session state | 对局身份、已接受布局、当前游戏事实、已确认行动/告知及顺序 | socket、resume credential、导航、AI 请求对象 |
| BotcGameModule / Game Engine | 命令验证与编排、接受规则结果、提交状态、选择投影 | 阵容搜索、推荐排序、平台存储与网络实现 |
| Setup / Rules / Information / Night progression | 各自内聚的纯计算与具体规则 | 第二份可写 Session、客户端显示状态、平台生命周期 |
| Storyteller Recommendation | 只读决策上下文、合法结果之间的建议与理由 | 玩家真实选择、唯一规则结果的替代值、直接 mutation |
| Room Runtime | 成员、权限、身份、commandId 去重、revision、持久化与交付 | 角色效果、生死、胜负及夜序规则 |
| Player / Moderator / Public projection | 从同一权威状态按接收者生成只读视图 | 另存可写真相、因调试扩大权限、直接暴露 Session |
| Client presentation / platform adapter | 展示、未确认输入、意图发送、平台能力 | 本地游戏裁判、平行夜间游标、恢复后自造结果 |
| Persistence codec / interchange adapter | 编解码、结构校验、明确的版本迁移和字段映射 | 正常游戏结算、补猜历史、独立恢复状态机 |

当前状态、不可变历史、只读快照和短生命周期的 UI 草稿可以同时存在；是否构成第二权威取决于是否能够独立写入或裁定游戏事实，不能仅按对象数量判断。

文件按内聚职责拆分，依赖方向服从上述 owner。使用已有 source-size gate 作为审查信号；不得把 Session façade 变成巨型规则类，也不得为了行数拆成大量一函数一文件、无职责转发层或通用 `utils`。新类型/文件本身不是新建 controller、service、registry 或测试文件的理由。

## 19.4 防止双轨、过度工程与过度测试

- **替换必须覆盖消费者并退出旧链。** 每个实际变更说明唯一 writer、受影响生产者/消费者、被替代入口及最小证据；同一逻辑变更迁移消费者并删除/退休旧生产路径及仅保护旧形状的测试。必要的存档版本转换仅留在边界，不演化成两套正常游戏流程。
- **先完成当前可玩行为。** 只抽取已存在的重复责任或明确架构 seam；不预建跨语言 SDK、通用角色 DSL、世界枚举、任意 Undo/Redo、全量事件重放或复杂证据平台。具体合法信息解析仍可保留，不能把禁止大型通用候选引擎误解为删除真实规则计算。
- **确定结果由规则 owner 计算。** 玩家选择由玩家决定；只有规则允许裁量的部分进入人工/推荐决策。AI 不可用时依旧保持相同提交路径；只有已有合法 fallback 才继续，缺少必要输入就停在该步骤，不能偷偷随机替代玩家选择或扩大权限。
- **验证按行为风险选择。** 先复用已有 owning coverage；只为重要新/变更合同或真实故障的有效覆盖缺口增加小型行为回归。不默认 test-first，不为每个文件/函数新增测试，不穷举没有独立风险的人数/座位/模式组合，不维护与实现逐行镜像的测试。样式、间距、文字等低风险细节用比例适当的检查。
- **验收证据不重复堆叠。** 游戏事实、隐私、重复/过期提交、保存恢复及关键推进链是优先风险；先纯/合同与自动多人，再 Simulator，硬件证据按需升级。正常代码 checkpoint 保留 AGENTS 规定的本地质量门和适用远端检查；纯文档按 diff/引用/一致性检查，不机械全量构建测试。通过后仅因新变化、失败或未解风险重跑。
- **完成按实际行为与旧链退出来判断。** 不按新增层数、删行数或测试数量计完成度。一次变更核对 owner、状态/记录一致性、全部相关消费者、隐私与恢复、旧路径退出和最小有效证据；发现设计歧义就回到语义决策，不在实现中静默扩张。提案、实施与已验证状态明确区分，当前进度只维护在 V5。

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
  ├─ B0B first-night / night sequencing ✅ COMPLETE
  │   ├─ B0B1 canonical order + first-night progression ✅
  │   ├─ B0B2 later-night dynamic eligibility / progression ✅
  │   │   ├─ B0B2A recurring / conditional eligibility ✅
  │   │   └─ B0B2B immediate trigger / role-transition sequencing ✅
  │   └─ B0B3 ownership hardening + live runtime progression ✅
  ├─ B0C rules/information foundations through B0C3A ✅ CHECKPOINTED
  │   └─ deeper recommendation quality — deferred until playable path needs it
  └─ Simulator-first BotC Playable Vertical Slice ← CURRENT PRODUCT DIRECTION
      ├─ SIM-0 Simulator Lab V2
      ├─ shared Lobby production interactions
      ├─ minimal BotC Setup/start command path
      ├─ role reveal / first-night / day-night playable flow
      └─ staged Developer Tools / real-device acceptance
        ↓
Production Web cutover / Reliability hardening — deferred, risk-driven
```

E2 与 E3.1–E3.7B 已完成，包括第二客户端边界、Raw WebSocket、reconnect/state-sync、same-commandId retry、微信 effects、public room projection、Cloudflare lifecycle、native composition、Developer Tools 工程壳/构建链与真实设备 lifecycle 验收。后续 W3D3 与 MG0A–MG0D 也已完成：identity recovery 已 game-neutral，room runtime/command dispatch 已具备第二游戏边界，Owner/Moderator 已拆分，微信发布形态已由一个 shared shell source 生成 `骏骏桌游-狼人` / `骏骏桌游-血染` 两个独立产品工程。BotC / Trouble Brewing 的 B0A–B0B3 已建立真实 GameModule 接入、独立 setup contract、canonical night ordering、动态 eligibility、即时 role transition 与 live monotonic night progression；B0B3 同时把 Setup Generation / Canonical Session / Game Engine / Rules-Information / Storyteller Recommendation 正式固化为长期 ownership contract。B0C1/B0C2/B0C3A 已进一步建立 Demon Info legality/baseline recommendation、Game Engine commit/private delivery、以及 Spy/Recluse registration 与 truthful Washerwoman candidate foundation。2026-09-30 产品路线纠偏后，后端规则/推荐深度不再继续领先于真实客户端可玩性：当前产品方向改为 Simulator-first BotC Playable Vertical Slice，先建立 Simulator Lab V2、真实 production client command path、最小 Setup、role reveal、首夜和最小 day/night loop，再按 Developer Tools → 单真机 → 双真机 + virtual clients → full-table 的顺序升级平台证据。高级 Storyteller Recommendation 仍保持独立长期层，但不作为当前 playable MVP gate。Production Web cutover 与 Reliability hardening 继续 deferred / risk-driven。微信 runtime 继续由 `tsconfig.wechat` 做 bundler-mode typecheck，再由显式 `esbuild` owner 为两个 generated product package 打出 CommonJS runtime bundle；生成产物不成为第二份源码。

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

长期客户端结构区分 **开发参考面** 与 **正式玩家终端**。Browser/Simulator 保留为应用语义、多人仿真与调试的 reference surface，不作为正式玩家产品目标；原因是私人震动/触觉提醒属于核心产品能力，而 plain browser/PWA 无法提供可靠的跨平台能力，尤其不能覆盖 iOS/Safari。

长期最终结构：

```text
                     Shared Client Protocol
                              |
                     Shared Client Core
                              |
                    Platform Capability Ports
               +--------------+------------------+
               |              |                  |
     Browser / Simulator   WeChat Runtime   Native Mobile Runtime
      dev/reference only      /      \          /            \
                      骏骏桌游-狼人 骏骏桌游-血染  Android        iOS
               |              |                  |
               +--------------+------------------+
                              |
                       Cloudflare Worker
                              |
                      GameRoom Durable Object
                              |
                         Game Catalog
                      /               \
                 Werewolf             BotC
```

Android/iOS 的具体实现框架不属于 shared architecture。Donut、Capacitor、React Native、Flutter 或 native Kotlin/Swift 均必须通过同一 Platform Port 边界接入；其中 Capacitor 若进入验证，应视为“Web 技术 + 原生容器/原生 capability plugin”，不能把 plain browser 的能力限制当成 native app 的上限。

系统必须保证：

> **网络可以中断，客户端可以重启，Transport 可以更换，但房间权威状态、玩家秘密信息和同一个用户意图的语义不能因此改变。**
