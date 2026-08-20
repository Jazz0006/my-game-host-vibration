# WerewolfGameJudge 底座迁移可行性审计

> 项目：`Jazz0006/my-game-host-vibration`  
> 候选底座：`olveryu/WerewolfGameJudge`  
> 日期：2026-08-17  
> 结论等级：架构级路线决策  
> 相关主设计：`长期架构与DurableObjects迁移设计_V4.md`

---

# 1. 审计结论

## 1.1 推荐结论

经过代码级复核，建议调整此前“继续当前仓库逐步吸收参考项目设计”的路线，改为：

> **优先采用 WerewolfGameJudge 作为新的工程底座，在其已经成熟的多游戏 Platform / Game Engine / Durable Objects / 客户端体系上继续开发；将当前 `my-game-host-vibration` 中真正有差异化价值的设计与代码有选择地迁移进去。**

这不是简单的“Fork 后删东西”，而是一次 **controlled fork / platform adoption**：

1. 保留 WerewolfGameJudge 已成熟的平台运行时和狼人杀引擎；
2. 保留其已经存在的多游戏抽象，而不是重新搭一套 GameModule；
3. 把当前项目的 `PendingInteraction`、按玩家裁剪的 View/隐私原则、震动唤醒、低注视夜间交互、整局自动主持等差异化设计移植过去；
4. Blood on the Clocktower 作为新的独立 game engine 注册，而不是塞入狼人杀 `ROLE_SPECS`；
5. 不立即删除账号、奖励、AI、R2、统计等非核心模块，先 Feature-disable / route-disable，待核心迁移稳定后再物理删除；
6. 当前仓库保留为迁移参考和回退基线，直到新底座达到功能等价。

## 1.2 为什么结论发生变化

此前把 WerewolfGameJudge 主要视为 Cloudflare / Durable Objects 参考实现时，继续当前项目是合理路线。

本次深度审计发现两个关键事实：

### 事实 A：它的狼人杀规则体系已经覆盖了我们接下来准备重新实现的大部分内容

包括：

- 46 个角色；
- 25 套预设板子与自定义板子；
- `ROLE_SPECS`；
- declarative abilities；
- effect vocabulary；
- generic / standalone resolver；
- NightPlan / night step order；
- 机械狼人 `wolfRobot`；
- 丘比特；
- 野孩子、盗贼、吹笛者等复杂机制；
- board integration / coverage contract tests。

这与当前 V4 中原计划的 B4/B5/B6/B7/B8 有很大重叠。

### 事实 B：它已经不是“狼人杀专用 Room Runtime”

Worker 层存在：

```text
packages/api-worker/src/games/
├── catalog.ts
├── werewolf/
└── fibking/
```

`WORKER_GAME_CATALOG` 同时注册 `werewolf` 与 `fibking`。

纯引擎层也有：

```text
packages/game-engine/src/games/catalog.ts
```

并同时注册：

```ts
werewolf: werewolfEngine
fibking: fibEngine
```

这证明多游戏边界并非纸面预留，而是已经被第二个真实游戏使用。

更重要的是，`GameRoomRuntime` 明确是 generic room authority，通过 `WorkerGameModuleResolver(gameType)` 调用游戏模块；它处理的是：

- Durable Object authoritative state；
- Room identity；
- command dispatch；
- revision；
- snapshot；
- WebSocket；
- idempotency / atomic pipeline；
- effect outbox；
- user event；
- room lifecycle。

它没有直接依赖狼人角色或狼人夜间 phase。

因此，引入 BotC 不需要先进行一次“大规模狼人 Room 多游戏化重构”。

---

# 2. 两条路线重新比较

## 2.1 方案 A：继续 `my-game-host-vibration`

已有优势：

- 简洁；
- 我们完全掌握代码；
- `GameModule` 已经明确；
- `PlayerView / HostView / PublicView` 隐私契约优秀；
- `PendingInteraction` 与震动唤醒模型直接对应产品体验；
- 当前架构测试边界清晰；
- BotC V4 架构已经提前规划。

但仍需自行完成：

- Cloudflare Worker；
- Durable Objects；
- WebSocket Hibernation；
- RoomRepository；
- revision / commandId / idempotency；
- reconnect；
- RoomDirectory；
- 微信小程序；
- 移动端壳；
- 狼人 Role Spec V2；
- Effect/Resolver vocabulary；
- NightPlan；
- Board/Script V2；
- 大量复杂角色；
- board integration coverage；
- 更完整的 CI / E2E。

结论：**代码干净，但未来存在大量重复建设。**

## 2.2 方案 B：以 WerewolfGameJudge 为底座

直接获得：

- 已验证的多游戏 engine catalog；
- typed `WorkerGameModule`；
- generic `GameRoomRuntime`；
- Durable Objects；
- WebSocket / Hibernation；
- room storage / repository；
- command pipeline；
- revision / snapshots；
- outbox / user events；
- Cloudflare Worker；
- React Native / Expo；
- Web；
- iOS / Android；
- 微信小程序 WebView 壳；
- 完整狼人杀 engine；
- 46 roles；
- 25 preset boards；
- Role Spec / Effect / Resolver / NightPlan；
- integration / contract / E2E testing infrastructure。

需要修改的主要不是“基础设施”，而是：

- 产品裁剪；
- 全局 UX；
- secret information projection；
- vibration-driven interaction；
- full-game orchestration；
- BotC engine。

结论：**从当前时间点向前看，方案 B 的总工作量显著更小。**

---

# 3. 关键架构发现

## 3.1 WorkerGameModule 已经完成我们原本准备做的 GameModule 演进

WerewolfGameJudge 的核心 Worker contract 是：

```text
RuntimeWorkerGameModule
├── gameType
├── stateVersion
├── parseCreateConfig
├── createInitialState
├── parseState
├── parseCommandResult
├── decidePublic
├── decideInternal
├── getPublicUserStats
├── getEffectBusinessKey
└── handleEffect
```

Typed definition 进一步连接：

```text
WorkerGameModuleDefinition
    ↓
GameEngineDefinition
    ↓
decide / evolve / normalize
```

这是比当前 `my-game-host-vibration.GameModule` 更成熟的生产 contract。

因此迁移后建议：

> 不把我们现有 `GameModule` 原样塞进新底座，也不要让两套 Game Module 长期并存。

应迁移的是它背后的设计原则：

- 游戏与 Room Runtime 隔离；
- transport-neutral game decisions；
- typed commands；
- deterministic engine；
- per-game state codec；
- per-game effect handling。

## 3.2 GameRoomRuntime 已经适合 BotC

当前 Room Authority 依赖：

```text
GameType
BaseGameState<GameType>
RuntimeWorkerGameModule
RoomRepository
EffectOutbox
UserEvents
```

而非：

```text
WerewolfRole
WerewolfPhase
NightStep
```

因此 BotC 可以自然注册成：

```text
GAME_ENGINE_CATALOG
├── werewolf
├── fibking
└── botc

WORKER_GAME_CATALOG
├── werewolf
├── fibking
└── botc
```

这是此次审计对路线决策影响最大的发现。

## 3.3 第二游戏 FibKing 是重要架构证据

`fibWorkerModule` 使用与狼人相同的 `defineWorkerGameModule()`：

```text
gameType: fibking
engine: fibEngine
stateCodec
createConfigSchema
publicCommandSchema
internalCommandSchema
effectSchema
handleEffect
```

因此“多游戏”不是预留接口，而是已经跑过第二实现的架构。

---

# 4. 当前项目哪些资产必须保留

换底座不代表当前工作白做。

以下设计应明确迁移。

## 4.1 PendingInteraction

当前项目：

```ts
PendingInteraction {
  id
  kind
  actorPlayerIds
  mode
  wakePolicy
  completionPolicy
  status
}
```

这是产品核心，不只是技术抽象。

WerewolfGameJudge 当前规则系统更擅长“角色有什么 action/effect”，但本产品还需要表达：

> **此刻应该唤醒谁、用什么方式提示、等待谁完成、其余玩家完全看不到什么。**

推荐在新底座新增平台/游戏之间的 interaction projection：

```text
Game Engine
    ↓
PendingInteraction / InteractionIntent
    ↓
private user event / per-user view
    ↓
Web / Expo / Miniapp
    ↓
vibration / audio / UI
```

## 4.2 PlayerView / HostView / PublicView 的隐私思想

当前项目已经明确：

```text
getPlayerView(playerId)
getHostView()
getPublicView()
```

并且 Host 本身也是玩家，不应因为创建房间而获得秘密游戏信息。

这一原则对 BotC 尤其关键。

参考项目 generic `RoomSnapshot` 包含完整 `state` envelope，并通过 WebSocket 广播 state update。即使狼人实现已经通过 user events 或 state shape 避免实际泄密，BotC 仍不应默认依赖“一个全房可见 snapshot”。

因此迁移时必须设计：

```text
AuthoritativeState        // server only
PublicProjection
PlayerProjection(userId)
HostOperationalProjection // 只有异常恢复权限，不等于全知说书人视角
PrivateUserEvent
```

这是迁移的硬性验收条件。

## 4.3 Night Orchestrator / 低注视 UX

本产品差异化体验：

- 每个玩家手持手机；
- 夜里闭眼；
- 只有需要行动的人被震动；
- 操作后立刻闭眼；
- 背景音持续；
- 不播放大量固定法官语音；
- 本局没有的角色不产生空等待；
- 尽量让夜间耗时等于真实行动耗时。

参考项目当前更强调自动语音首夜主持，白天主要线下完成。

因此迁移不是“直接使用它 UI”，而是：

> **保留它的 engine/platform，重做/扩展 interaction delivery 与完整游戏 flow。**

## 4.4 V4 BotC 领域模型

以下内容不应因为换底座而丢弃：

```text
TruthState
Registration
AbilityStatus
Information Generator
Legal Outcome Space
StorytellerPolicy
InformationRecord
KnowledgeLedger
```

这些应成为独立 `botc` engine 的内部模型。

---

# 5. 哪些模块建议直接保留

优先原样或轻量适配保留：

```text
packages/game-engine/src/platform/**
packages/api-worker/src/platform/gameModules/**
packages/api-worker/src/platform/room/**
packages/api-worker/src/platform/userEvents/**
packages/game-engine/src/games/werewolf/**
packages/api-worker/src/games/werewolf/**
packages/api-worker/src/games/catalog.ts
packages/game-engine/src/games/catalog.ts
WebSocket / reconnect infrastructure
Expo Web/Native 基础
miniapp WebView shell
测试基础设施
```

其中狼人 engine 不建议重写为我们现在的 Role Registry。

原因：上游 `ROLE_SPECS / effects / resolvers` 已经覆盖更广，并有大量测试资产。

---

# 6. 哪些模块不要急着删除

建议先 Feature-disable，再删除：

- Auth/account；
- D1 用户体系；
- R2；
- Gemini AI；
- XP/等级；
- 奖励；
- 扭蛋；
- 收藏品；
- avatar cosmetics；
- statistics；
- Sentry。

原因：

这些可能与：

- game completion；
- HTTP routes；
- database migrations；
- navigation；
- user identity；
- effect outbox；
- Worker env bindings

存在交叉依赖。

正确顺序是：

```text
先让核心房间 + 狼人 + 新 UX 正常运行
    ↓
通过 feature flags / route registration 去掉产品入口
    ↓
确认无运行依赖
    ↓
逐模块删除
```

而不是 Fork 后第一步大规模 `rm -rf`。

---

# 7. BotC 接入可行性

## 7.1 总体判断

**可行，而且比在当前仓库从零实现 Cloud Runtime 更合适。**

BotC 不应该进入 `werewolf ROLE_SPECS`。

建议：

```text
packages/game-engine/src/games/
├── werewolf/
├── fibking/
└── botc/
    ├── engine.ts
    ├── state/
    ├── commands/
    ├── events/
    ├── effects/
    ├── roles/
    ├── scripts/
    ├── information/
    ├── registration/
    ├── knowledge/
    └── storyteller/

packages/api-worker/src/games/
└── botc/
    ├── module.ts
    ├── schemas.ts
    └── effects.ts
```

## 7.2 BotC state

BotC 自己定义：

```text
BotCGameState extends BaseGameState<'botc'>
```

内部包含：

```text
TruthState
RoleAssignments
CurrentCharacter
Alignment
AbilityStatus
Poison/Drunk effects
Registrations
Nominations
Votes
Executions
Deaths
Night/Day history
InformationRecords
KnowledgeLedger
Pending decisions
```

Room Runtime 无需理解这些字段。

## 7.3 BotC command/event/effect

示例：

```text
Public commands
- submitNightChoice
- nominate
- vote
- confirmInformation

Internal commands
- resolveNight
- applyPoison
- transformCharacter
- generateInformation

Game events
- PlayerPoisoned
- RegistrationResolved
- InformationGenerated
- PlayerExecuted
- CharacterChanged

Effects
- privatePlayerInformation
- wakePlayer
- scheduleContinuation
- storytellerRecommendationRequest (future)
```

这可以直接映射当前 `GameEngineDefinition + WorkerGameModule` 模式。

---

# 8. BotC 最大的新增平台要求：Projection / Secret Information

本次审计认为这是 Fork 方案最大的架构工作点。

狼人很多状态可以公开，而 BotC 的核心恰恰是：

```text
Server Truth
≠ Player A Knowledge
≠ Player B Knowledge
≠ Public Knowledge
```

因此在正式 BotC 开发前，应先完成：

## Projection Contract

```ts
interface GameProjection<TState, TPublic, TPlayer> {
  getPublicProjection(state: TState): TPublic;
  getPlayerProjection(state: TState, userId: string): TPlayer;
}
```

或者采用：

```text
Public snapshot
+
Private UserEvent stream
```

但必须有 contract tests 保证：

- 其他玩家不能看到目标玩家身份；
- Host 不能自动看到全知状态；
- 查验结果只有行动者获得；
- 恋人/狼人等 group secret 只发给正确成员；
- BotC poisoned/drunk truth 不泄漏；
- Spy/Recluse registration truth 不泄漏；
- reconnect 后私有知识可恢复，但不会跨玩家恢复。

当前项目的 View contract 测试应迁移并扩展到这里。

---

# 9. 当前 PR B4 应如何处理

## 建议

PR #11 暂时保持 Draft，不继续 B4.1。

B4 已经产生了有价值的概念验证：

- relationship sidecar state；
- interaction vs death effect；
- recursive death-chain；
- 去重/防循环。

但参考项目已经有丘比特、复杂 effect/resolver 和更多角色组合，因此没有必要继续把它扩展成另一套狼人杀规则引擎。

建议后续：

1. 保留 PR #11 作为 spike/reference；
2. 不合并到未来的新底座；
3. 从测试中提取需要迁移的行为场景；
4. 在 WerewolfGameJudge engine 中验证其现有丘比特实现是否满足目标规则；
5. 如有差异，修改其现有 Role Spec/Resolver，而不是继续维护两套实现。

如果决定正式迁移，PR #11 可以关闭并在说明中链接迁移审计。

---

# 10. 原 V4 后续路线需要调整

原计划：

```text
B4 Cupid
→ B4.1 Lovers Victory
→ B4.5 Reference Audit
→ B5 Mechanical Wolf
→ B6 RoleDefinition V2
→ B7 NightPlan
→ B8 Script/Board V2
→ Cloudflare migration
```

本审计建议取消其中大量重复建设。

新路线：

```text
M0 Fork/Adoption Baseline
    ↓
M1 Strip by Feature Disable
    ↓
M2 Product UX Port
   - PendingInteraction
   - vibration wake
   - private interaction
    ↓
M3 Full-game Werewolf Orchestration
    ↓
M4 Projection / Secret Information Contract
    ↓
M5 BotC Skeleton Game Module
    ↓
M6 BotC Truth/Ability/Registration
    ↓
M7 BotC Information + Knowledge Ledger
    ↓
M8 BotC Storyteller Policy
    ↓
M9 Trouble Brewing vertical slice
```

原 B5/B6/B7/B8 基本由上游现有 engine 替代。

---

# 11. 推荐迁移步骤

## M0 — 新底座建立

不要立即覆盖现仓库。

建议两种方式之一：

### 方案 1（优先）

新建自己的 Fork repo，例如：

```text
Jazz0006/MultiGameHost
```

以 WerewolfGameJudge 当前稳定 commit 为 baseline。

### 方案 2

在现仓库建立 orphan/new-root migration branch。

不推荐，因为历史会混合两套完全不同的工程树。

因此更推荐独立新仓库。

记录：

```text
upstream = olveryu/WerewolfGameJudge
origin   = Jazz0006/<new repo>
```

保留 upstream remote，方便未来选择性吸收修复。

## M1 — Minimal Product Mode

先不物理删除：

```text
关闭/隐藏 gacha
关闭 rewards
关闭 cosmetics
关闭 AI assistant
关闭 ranking/stats UI
```

目标只保留：

```text
create room
join room
seat
choose board
role reveal
night actions
reconnect
```

验收：上游全套核心测试仍通过。

## M2 — Interaction UX

移植当前项目的：

```text
PendingInteraction
wakePolicy
completionPolicy
actor privacy
vibration
background audio strategy
```

先在狼人一两个角色上端到端验证。

## M3 — Full-game Werewolf

将当前“首夜法官”扩展到：

- multiple nights；
- day state；
- elimination/vote optional assistance；
- death-triggered skills；
- full reconnect recovery。

## M4 — Projection Privacy

在 BotC 之前完成。

这是硬门槛。

## M5 — BotC Hello World

新增：

```text
gameType = 'botc'
BotCGameState
BotCEngine
botcWorkerModule
```

先只支持：

```text
create room
join
assign simple roles
private role reveal
start night
finish night
```

不用第一步就实现所有 Trouble Brewing。

## M6-M9 — 按 V4 BotC 模型逐层扩展

依次：

1. poison/drunk AbilityStatus；
2. Spy/Recluse Registration；
3. information legal outcome generation；
4. KnowledgeLedger；
5. storyteller recommendation；
6. nominations/execution/death chain；
7. role transforms；
8. Trouble Brewing vertical slice。

---

# 12. 工作量等级比较

以下仅表示相对改动面，不是工期承诺。

| 能力 | 当前仓库继续做 | WJG 底座 |
|---|---|---|
| DO Room Runtime | L | 已有 |
| WebSocket/reconnect | L | 已有 |
| command/revision/idempotency | M-L | 已有 |
| 微信小程序壳 | M | 已有 |
| Native App 基础 | M-L | 已有 |
| 大量狼人角色 | XL | 已有 |
| Board/RoleSpec/Effect | L-XL | 已有 |
| NightPlan | M-L | 已有 |
| 多游戏 catalog | M | 已有且第二游戏已验证 |
| 震动 Interaction UX | 已有设计/M | M |
| Player secret projection | 已有设计/M | M |
| Full-game flow | M-L | M-L |
| BotC engine | L-XL | L-XL |
| 删除无关产品功能 | 无 | M（可渐进） |

总体：

> **WJG 底座把大量“通用平台 + 狼人杀成熟度”的 XL 工作直接降为已完成；新增的主要成本是裁剪和迁移差异化 UX。**

---

# 13. 风险

## 13.1 上游变化

Fork 后不应自动 merge upstream main。

策略：

- 固定 adoption baseline commit；
- upstream 只作为 patch source；
- 小范围 cherry-pick；
- 不长期追求保持 fork diff 很小。

因为产品方向会快速分叉。

## 13.2 代码复杂度

WerewolfGameJudge 比当前项目大得多。

代价：

- 学习成本提高；
- feature ownership 更复杂；
- 修改需要遵守更多 contract tests。

但这也是成熟度带来的必然成本。

对于单人开发，关键不是“代码最少”，而是：

> **自己真正需要维护的新增规则代码最少。**

## 13.3 不要把 BotC 强塞进 Werewolf Effect DSL

这是最重要的领域风险之一。

可以共享：

```text
Game Engine contract
Room Runtime
Commands/Events/Effects pattern
Interaction delivery
```

不应强制共享：

```text
Werewolf ROLE_SPECS
Werewolf role effect vocabulary
Werewolf NightPlan semantics
```

BotC 应拥有独立领域语言。

## 13.4 MIT 许可证

WerewolfGameJudge 使用 MIT License。

允许：

- use；
- copy；
- modify；
- merge；
- publish；
- distribute；
- sublicense；
- sell。

要求保留原 copyright notice 和 MIT permission notice 于软件副本或 substantial portions。

这不构成 adoption 阻碍。

---

# 14. 决策门槛

在真正切换主开发仓库前，建议做一个很小的 Adoption Proof：

## Gate A — 原项目跑起来

本地运行 WerewolfGameJudge 的核心 Web + Worker + Room。

## Gate B — 精简入口

不删代码，只隐藏非核心功能后仍正常创建/加入狼人房间。

## Gate C — 震动 PoC

选择一个角色，例如预言家：

```text
server emits private action
→ only seer client receives actionable interaction
→ device vibration
→ submit
→ reconnect
→ state remains correct
```

## Gate D — BotC dummy module

注册第三个 game type：

```text
botc
```

实现最小：

```text
createInitialState
decide/evolve
one command
one private interaction
```

如果 A-D 全部成立，则无需继续争论路线，正式采用新底座。

---

# 15. 最终建议

## 推荐：采用 WerewolfGameJudge 底座，进行受控迁移

理由按重要性排序：

1. **它已经真正多游戏化，而非狼人杀硬编码 Room。**
2. **它已经拥有我们计划自行实现的大部分狼人规则架构。**
3. **它的 Cloudflare Runtime、reconnect、miniapp、native 基础均直接匹配长期目标。**
4. **MIT 许可允许我们合法深度修改与商业化。**
5. **BotC 可以作为 sibling engine 加入，不需要污染狼人 engine。**
6. 当前项目最有价值的差异化设计可以小范围迁移，而不需要保留整套旧运行时。

因此，从 2026-08-17 这个节点起：

> **继续在当前仓库实现 B5/B6/B7/B8 的机会成本已经高于换底座成本。**

当前仓库不应删除。它应作为：

- 产品需求参考；
- interaction UX reference；
- privacy contract reference；
- BotC V4 architecture source；
- migration regression oracle。

而新主线则建议从 WerewolfGameJudge 的稳定 baseline 建立。

---

# 16. 下一步

建议下一项工作不是继续 B4.1，而是：

> **执行 M0 Adoption Proof：建立 WJG 派生开发仓库，并完成 A-D 四个 Gate 中的 Gate A/B 基线验证。**

在真正迁移任何 BotC 或复杂角色代码之前，先证明新底座能以“精简产品模式”稳定运行。
