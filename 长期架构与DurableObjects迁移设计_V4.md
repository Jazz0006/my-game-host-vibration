# 无法官桌游主持平台：长期架构、规则引擎与 Durable Objects 迁移设计 V4

> 项目：`Jazz0006/my-game-host-vibration`  
> 主分支：`main`  
> 当前技术栈：Node.js + TypeScript + Express + Socket.IO + Web  
> 目标平台：Cloudflare Workers + Durable Objects + Web / 微信小程序  
> 主要参考项目：`olveryu/WerewolfGameJudge`  
> 文档版本：V4  
> 日期：2026-08-17  
> 本文件取代 `长期架构与DurableObjects迁移设计_V3.md`，作为后续实施的主设计基线。

---

# 1. V4 为什么需要重写

V3 的重点是：保护现有 `GameModule`，完成 Durable Objects、Interaction、Reconnect 与多客户端迁移。

经过 PR A～B3.2 以及对 `WerewolfGameJudge` 的进一步调研后，项目已经进入第二阶段：

> **平台层的抽象方向已经基本明确，接下来最大的长期风险不再是“如何上云”，而是“如何让不同游戏、不同板子、不同复杂角色共享一套可维护的规则体系”。**

尤其是未来 Blood on the Clocktower（BotC）会引入：

- 角色实际身份与玩家认知身份不一致；
- 醉酒、中毒导致能力失效但角色本身不一定改变；
- Spy / Recluse 类“登记为其他身份/阵营”；
- Imp 传位、Scarlet Woman 继承恶魔等角色转换；
- Fortune Teller 红鲱鱼、Drunk 假身份等个体化信息；
- Undertaker / Empath / Chef 等依赖历史与邻接关系的信息；
- 提名、处决、死亡、旅行者、死亡后能力等白天复杂触发；
- 说书人合法选择空间，以及自动说书人推荐/决策算法。

如果继续让这些逻辑堆在 `domain/game.ts`、固定 `GamePhase` 或大量角色 if/else 中，未来必然再次大规模重构。

V4 因此统一规划：

1. 平台层继续保持游戏无关；
2. Board / Script 只描述“本局有哪些角色和规则版本”；
3. Role Spec 描述角色能力与交互；
4. 通用 Effect + Resolver 处理可复用规则；
5. 真正特殊的角色允许 standalone resolver / hook；
6. 复杂关系与动态效果进入游戏专属 RuleState；
7. BotC 单独建立“真实状态 / 信息生成 / 玩家认知 / 说书人决策”四层模型；
8. Durable Objects 只承载权威房间与状态，不理解具体游戏规则。

---

# 2. 产品边界保持不变

本项目仍然是：

```text
Cloud Online Automatic Host
每名玩家一台手机
系统自动主持
面对面讨论仍在线下完成
```

核心体验：

- 无真人法官，所有人都能参与；
- 手机只负责身份、秘密信息、夜间行动和少量控制；
- 震动只唤醒真正需要行动的玩家；
- 不运行本局不存在的夜间阶段；
- 熄屏、切 App、网络切换属于正常生命周期；
- 重连必须可靠；
- 房主也是玩家，不能因为“Host”身份看到秘密信息；
- V1 先做好狼人杀，但平台核心不能写死狼人杀；
- 后续扩展 BotC，并支持自动说书人信息/线索推荐。

`CampBoardGameHost` 仍是独立 Android 离线主持工具，可共享角色数据和纯规则算法，但不共享云端 Room Runtime。

---

# 3. V4 总体架构

```text
Cloudflare Worker
      │
      ▼
GameRoom Durable Object
      │
      ├── Room / Session / Reconnect / Revision / commandId
      ├── WebSocket / Snapshot / Private Delivery
      │
      ▼
GameModule
      │
      ├── WerewolfGameModule
      └── BotCGameModule (later)
              │
              ▼
       Game Rules Layer
              │
   ┌──────────┼───────────┐
   │          │           │
Script     RoleSpec    RuleState
/Board        │           │
   │          ▼           │
   │      RuleEffect      │
   │          │           │
   │          ▼           │
   └────── Resolver ──────┘
              │
              ▼
      PendingInteraction
              │
       Web / Mini Program
```

长期原则：

> **Room 不知道角色；Board 不实现角色；Role 不知道 Socket；Resolver 不知道 UI。**

---

# 4. 已完成的架构工作

截至 2026-08-17：

## PR A — GameModule hardening ✅

- GameModule 纯规则测试；
- Player / Host / Public View 隐私边界；
- 多回合状态测试；
- Host 作为普通玩家，不能读取秘密 actor 信息。

## PR B — PendingInteraction ✅

- 建立 transport-neutral `PendingInteraction`；
- 区分 single / group；
- wakePolicy / completionPolicy；
- 私有 actor 信息只留服务器端。

## PR B2 — Werewolf Role Registry / Script Architecture ✅

- RoleDefinition；
- Role Registry；
- ScriptDefinition；
- registry-driven interaction planner。

## PR B3 — Complex Role Hook Architecture Spike ✅

- beforeDeath；
- afterDeath；
- resolveTeam；
- evaluateVictory；
- owner 与 death subject 分离；
- 用 Hunter 验证复杂触发。

## PR B3.1 — Hunter runtime migration ✅

正式 Hunter 死亡触发进入：

```text
Registry -> RoleHookRunner -> runtime adapter -> domain transition
```

## PR B3.2 — Remove legacy Hunter fallback ✅

- domain 不再包含 Hunter-specific fallback；
- 主规则测试通过 `WerewolfDomainFacade` 走生产路径；
- 24/24 test files、144/144 tests 通过。

## PR B4 — Cupid relationship + chained death spike 🚧

当前 Draft 目标：

- `WerewolfRuleState`；
- relationship；
- typed RuleEffect；
- interaction effect / death effect；
- recursive death-chain resolver；
- 丘比特仅作为 experimental role，不进入正式板子。

---

# 5. 从 WerewolfGameJudge 得到的关键结论

进一步调研发现，参考项目已经形成了非常成熟的规则组织方式。

## 5.1 Board / Template 只负责角色组合

参考项目的板子本质上是：

```ts
{
  name,
  category,
  roles: RoleId[]
}
```

板子不实现：

- 女巫药水规则；
- 猎人死亡触发；
- 机械狼学习；
- 野孩子偶像；
- 狼美人连锁死亡。

结论：

> **本项目的 ScriptDefinition 也应坚持只描述本局角色、人数、规则版本和极少量显式 variant，不复制角色逻辑。**

## 5.2 角色规则集中到 Role Spec

参考项目 V2 的角色定义包含：

```text
RoleSpec
├── metadata
├── faction / team
├── abilities[]
├── nightSteps[]
├── effects[]
├── resources
├── immunities
├── recognition
├── displayAs
└── special metadata
```

这说明我们的 `RoleDefinition` 应逐步从：

```text
metadata + interaction + hooks
```

演进到：

```text
metadata
+ abilities
+ interactions
+ resources
+ effects
+ hooks (只保留不能声明化的逻辑)
```

## 5.3 Effect vocabulary 非常值得借鉴

参考项目已有类似：

```text
check
writeSlot
charm
chooseIdol
block
learn
confirm
swap
mimic
convert
chooseCard
```

这验证了 B4 将 `TriggeredAction` 升级为 `RuleEffect` 的方向。

本项目长期可形成自己的 effect vocabulary，例如：

```text
interaction
information
kill / death
preventDeath
protect
linkRelationship
removeRelationship
changeRole
changeAlignment
grantAbility
removeAbility
registerAs
applyStatus
consumeResource
nominationEffect
executionEffect
voteEffect
```

但原则是：

> **不追求把所有规则都做成通用 DSL。**

## 5.4 Generic Resolver + Standalone Resolver

简单角色：

```text
RoleSpec -> Generic Resolver
```

复杂角色：

```text
RoleSpec -> Standalone Resolver / Hook
```

避免两种极端：

- 所有角色都写成硬编码 if/else；
- 为了“数据驱动”把极复杂规则硬塞进 JSON DSL。

## 5.5 板子必须有组合测试

单角色测试正常不代表组合正常。

长期测试层次应为：

```text
Role unit test
        ↓
Resolver / Effect test
        ↓
Board integration test
        ↓
Full GameModule test
        ↓
Room / reconnect test
```

建议建立 board coverage contract：正式支持的每个 preset script 至少有一个关键组合 integration test。

---

# 6. Werewolf 长期规则模型

## 6.1 ScriptDefinition

建议长期模型：

```ts
type ScriptDefinition = {
  id: string;
  name: string;
  gameType: "werewolf";
  roleIds: string[];
  rulesetId: string;
  tags?: string[];
  roleOverrides?: Record<string, ExplicitVariantOverride>;
};
```

`roleOverrides` 只允许处理明确的地方规则/版本差异，不允许复制整份角色实现。

例如：

```text
classic-cn-12p
party-cupid-10p
advanced-mechanical-wolf-12p
```

## 6.2 RoleSpec / RoleDefinition

长期目标：

```ts
RoleDefinition {
  id
  name
  team
  description

  abilities[]
  interactions[]
  resources?
  recognition?
  effects?
  hooks?
}
```

## 6.3 RuleState

复杂角色会产生不能合理塞进基础 `GameState` 的持久数据：

```text
relationships
statuses
roleTransforms
alignmentOverrides
abilityGrants
marks
resourceState
```

因此 B4 引入的 sidecar `WerewolfRuleState` 是正确方向。

长期建议：

```ts
WerewolfState {
  base: WerewolfBaseState;
  rules: WerewolfRuleState;
}
```

而不是无限扩展：

```text
loverA
loverB
wildChildIdol
mechanicalWolfLearnedRole
...
```

## 6.4 RuleEffect

B4 后建议收敛为 discriminated union。

```ts
type WerewolfRuleEffect =
  | InteractionEffect
  | DeathEffect
  | RelationshipEffect
  | StatusEffect
  | RoleChangeEffect
  | AlignmentEffect
  | ResourceEffect;
```

Effect 只表达“发生什么”，Resolver 决定“如何合法执行”。

## 6.5 Effect Resolver

Resolver 必须处理：

- effect 顺序；
- 去重；
- recursive chain；
- conflict；
- victory check 时机；
- before/after hooks；
- interaction queue。

例如丘比特：

```text
A 被杀
→ DeathEffect(A)
→ afterDeath
→ DeathEffect(B, ability)
→ B death hooks
→ queue 清空
→ 最后统一 victory check
```

猎人：

```text
Hunter death
→ afterDeath
→ InteractionEffect(hunter_shot)
→ 暂停 normal continuation
→ 玩家完成开枪
→ 继续 effect / victory pipeline
```

---

# 7. 为什么丘比特和机械狼是关键架构测试角色

## 7.1 丘比特

验证：

- first-night one-shot interaction；
- persistent relationship；
- cross-player rule；
- recursive death；
- future alignment / special victory。

B4 只验证：

```text
setup + relationship + chained death
```

暂不正式加入 production deck。

## 7.2 机械狼

机械狼比丘比特更重要，因为它会验证：

```text
identity != abilities
```

未来模型不能再默认：

```text
RoleId = 玩家拥有的全部能力
```

需要逐步支持：

```text
PlayerRuleProfile
├── baseRole
├── effectiveAlignment
├── grantedAbilities[]
├── suppressedAbilities[]
├── statuses[]
└── registrations[]
```

参考项目已经有 `wolfRobot` + `learn` effect，下一阶段应完整拆解其：

```text
RoleSpec
→ learn effect
→ resolver
→ state
→ night plan
→ information exposure
```

再决定本项目如何实现。

---

# 8. 不同板子、不同规则版本如何统一处理

长期规则优先级：

```text
Base Game Rules
      ↓
Role Spec
      ↓
Script / Ruleset explicit variant
      ↓
Runtime statuses/effects
```

不要出现：

```text
if boardName === "某某板子"
```

规则差异必须有明确来源：

```text
rulesetId
role variant id
script override
runtime status/effect
```

建议：

```ts
RulesetDefinition {
  id
  version
  semantics
}
```

例如将来可显式区分：

```text
werewolf-cn-classic-v1
werewolf-party-cupid-v1
botc-official-2026
```

这样角色规则升级时可做版本迁移，不依赖隐藏行为。

---

# 9. NightPlan 必须最终取代固定 NIGHT_ORDER

当前 legacy domain 仍有固定：

```text
guard -> werewolf -> witch -> seer
```

长期必须改为：

```text
Script roles
   ↓
collect Role interactions
   ↓
filter by current eligibility
   ↓
NightPlan order
   ↓
PendingInteraction queue
```

新增角色只声明：

- 它有哪些 interaction；
- 哪些 night 可运行；
- order / priority；
- eligibility。

Board 不写夜间顺序。

这个改动应在上 Durable Objects 前完成主要规则 ownership 迁移，避免把 legacy phase 模型固化到云端状态格式。

---

# 10. BotC 为什么不能只复用 Werewolf RoleEffect

BotC 的关键复杂度不是“角色更多”，而是：

> **游戏真实状态、角色能力是否有效、角色登记结果、系统向玩家展示的信息、玩家对世界的认知，这几层经常不一致。**

狼人杀通常可以近似：

```text
true role -> action -> result
```

BotC 经常是：

```text
true state
   ↓
ability eligibility
   ↓
drunk / poisoned / registration / protection / transformation
   ↓
legal information space
   ↓
storyteller choice
   ↓
shown information
   ↓
player knowledge
```

因此 BotC 必须新增专用模型，而不是把几十个字段加到 WerewolfGameState。

---

# 11. BotC 建议的四层状态模型

## 11.1 TruthState — 世界真实状态

包含：

```text
actual role
actual alignment
alive/dead
ability active/inactive
poisoned/drunk
role transformation
red herring
registrations
persistent marks
nomination/execution history
night/day counters
```

这是 server-authoritative truth。

## 11.2 Registration Layer — “算作什么”

BotC 中“实际是什么”和“能力读取时算作什么”必须分离。

例如：

- Recluse 可登记为邪恶/爪牙/恶魔；
- Spy 可登记为善良/镇民/外来者；
- 某些角色对特定能力有特殊 registration。

建议 API：

```ts
resolveRegistration({
  observerAbility,
  subjectPlayerId,
  context,
}) -> RegistrationOptions
```

不要直接改 `actualRole`。

## 11.3 Information Layer — 信息生成

BotC 的信息类能力不能直接返回一个“真值”。

建议：

```text
Ability Resolver
      ↓
Truth Candidate Generator
      ↓
Impairment Policy
      ↓
Registration Resolver
      ↓
Legal Information Options
      ↓
Storyteller Decision
      ↓
Final Information Packet
```

例如 Fortune Teller：

```text
选择 A/B
→ 检查其中是否恶魔或 red herring
→ 考虑 poisoned/drunk
→ 生成合法 yes/no 空间
→ storyteller policy 选择最终结果
→ 写入 InformationRecord
```

## 11.4 Knowledge / Observation Ledger — 玩家被告知了什么

必须记录：

```ts
InformationRecord {
  id
  playerId
  sourceRoleId
  round
  interactionId
  shownPayload
  truthBasis?
  impairmentState?
  storytellerDecisionId?
}
```

原因：

- 自动说书人推荐算法需要知道过去给过什么信息；
- 玩家视角一致性算法需要基于“这个玩家实际看到了什么”；
- 重连时必须恢复玩家已经见过的信息；
- 不能从当前 TruthState 反推过去曾显示的内容。

---

# 12. BotC 的醉酒 / 中毒模型

必须区分：

```text
role identity
ability ownership
ability functioning
information truthfulness
```

建议：

```ts
AbilityStatus {
  owned: boolean;
  functioning: boolean;
  impairmentReasons: EffectId[];
}
```

例如 poisoned Soldier：

```text
baseRole = soldier
owned ability = soldier immunity
effective ability = disabled
```

不是把 role 改成 villager。

Drunk 外来者更特殊：

```text
actualRole = drunk
perceivedRole = washerwoman / librarian / ...
```

因此至少需要：

```text
actualRole
presentedRole
```

而 presentedRole 属于玩家认知/展示层，不是 TruthState 的替代。

---

# 13. BotC 的 Role Change / Ability Grant

Imp 自刀传位、Scarlet Woman 继任等意味着：

```text
base identity
current role
ability source
alignment
```

都可能变化。

建议通过显式 Effect：

```text
ChangeRoleEffect
ChangeAlignmentEffect
GrantAbilityEffect
RemoveAbilityEffect
```

并记录 transition history：

```text
RoleTransitionRecord
```

避免只覆盖 `roles[playerId]` 后丢失历史。

---

# 14. BotC 白天规则需要 Event Pipeline

BotC 白天不是单纯 `day_vote -> result`。

需要事件：

```text
NominationStarted
NominationResolved
VoteCast
VoteCounted
ExecutionScheduled
ExecutionResolved
PlayerDied
DayEnded
```

角色可订阅/影响：

```text
onNomination
onVote
beforeExecution
afterExecution
beforeDeath
afterDeath
onDayEnd
```

例如 Virgin、Slayer、Mayor、Saint 等不能合理塞进固定 day phase if/else。

长期应形成：

```text
GameEvent
  ↓
Rule Evaluation
  ↓
RuleEffect[]
  ↓
EffectResolver
```

狼人杀也可以逐步复用这个模式，但 BotC 是必须项。

---

# 15. 自动说书人决策必须与 Rule Engine 分离

BotC 最大的差异是：很多时候规则只定义“哪些结果合法”，真正展示哪个信息属于说书人选择。

因此必须分成：

```text
Rule Engine
→ 计算 legal outcome space

Storyteller Policy
→ 在合法空间内选择 / 推荐
```

Storyteller Policy 可以逐步升级：

## Level 1 — deterministic heuristic

- 避免明显破局；
- 保持信息平衡；
- 简单随机 tie-break。

## Level 2 — global consistency heuristic

考虑：

- 每个玩家已经得到的信息；
- 全局信息强度；
- 好坏阵营可推理程度；
- 避免某一玩家连续收到过强/过弱信息。

## Level 3 — AI recommendation

AI 只做：

```text
legal options ranking
explanation
storytelling recommendation
```

AI **不能自行创造规则外结果**。

正式写状态的仍是 deterministic Rule Engine。

这与现有自动说书人“玩家认知一致性算法”方向可以自然结合。

---

# 16. BotC 推荐目录结构

```text
src/games/botc/
├── BotCGameModule.ts
├── scripts/
│   ├── troubleBrewing.ts
│   └── ...
├── roles/
│   ├── RoleDefinition.ts
│   ├── registry.ts
│   └── resolvers/
├── rules/
│   ├── RuleEffect.ts
│   ├── EffectResolver.ts
│   ├── RegistrationResolver.ts
│   ├── AbilityStatusResolver.ts
│   └── EventPipeline.ts
├── state/
│   ├── BotCTruthState.ts
│   ├── BotCRuleState.ts
│   ├── KnowledgeLedger.ts
│   └── History.ts
├── information/
│   ├── InformationGenerator.ts
│   ├── LegalOutcome.ts
│   └── InformationRecord.ts
└── storyteller/
    ├── StorytellerPolicy.ts
    ├── HeuristicPolicy.ts
    └── RecommendationContext.ts
```

不要在 `core/` 中加入 BotC 专有概念。

---

# 17. 与 Durable Objects 的关系

Durable Object 只持久化：

```text
RoomState
GameModuleState
RuleState
KnowledgeLedger
revision
command dedupe
session metadata
```

DO 不实现：

- wolf rules；
- Cupid linked death；
- BotC poison；
- Storyteller recommendation。

正确关系：

```text
WebSocket Command
      ↓
GameRoom DO
      ↓
GameModule.handleCommand()
      ↓
Rule Engine / Effect Resolver
      ↓
new authoritative state
      ↓
persist + revision++
      ↓
player-specific snapshots/events
```

这样 Node runtime 与 Cloudflare runtime 可以共享同一个 GameModule。

---

# 18. Reconnect 与复杂游戏状态

BotC 强化了一个已有原则：

> **重连必须恢复 snapshot，而不是依赖客户端记忆或仅回放最后一步。**

Player snapshot 必须至少包含：

```text
public game state
my presented identity
my alive/dead state
my current pending interaction
my previously shown information
my private persistent marks/relationships (仅有权知道的部分)
revision
```

Host 仍然不能因为是 Host 获得秘密 TruthState。

如需要异常恢复，应设计单独的 privileged recovery capability，而不是直接复用 HostView。

---

# 19. 隐私模型必须继续强化

规则引擎内部可以知道：

```text
actual role
relationships
registrations
poison targets
red herring
storyteller choices
```

但 View 必须最小化。

建议继续维持：

```text
Truth State
   ↓
PlayerView builder
HostView builder
PublicView builder
```

BotC 尤其要避免：

- host snapshot 泄露 actual role；
- error message 泄露 poisoned/drunk；
- interaction kind 泄露隐藏角色存在；
- reconnect payload 泄露别人 relationship；
- deterministic client logic 通过“不出现某步骤”推断秘密状态。

必要时 Night Orchestrator 可使用 dummy/background timing 来避免某些强侧信道，但只在实际测试发现需要时引入。

---

# 20. 统一测试策略

## 20.1 Role contract tests

验证：

- RoleId 唯一；
- interaction / effect 定义合法；
- resource schema；
- night order；
- faction/team。

## 20.2 Effect / Resolver tests

验证：

- recursive effects；
- conflict；
- ordering；
- dedupe；
- victory timing。

## 20.3 Board / Script integration tests

每个正式 preset 至少覆盖一个关键组合。

例如：

```text
Guard + Witch same target
Cupid + Hunter chain
Mechanical Wolf learned ability
BotC Poisoner + Soldier + Imp
BotC Recluse registration + Investigator
```

## 20.4 GameModule full-flow tests

必须验证：

- 真实命令流程；
- PlayerView privacy；
- reconnect snapshot；
- multi-round persistent state。

## 20.5 BotC information consistency tests

新增：

```text
TruthState
→ legal outcome
→ chosen information
→ KnowledgeLedger
```

并验证：

- poisoned info 可以合法错误；
- sober info 不得出现非法结果；
- registration 正确影响信息；
- 已展示信息在重连后不变化；
- recommendation 不能越过 legal outcome boundary。

---

# 21. 后续统一开发路线图

以下路线取代 V3 中零散 PR 规划。

## Phase 1 — Werewolf Rule Engine Stabilization

### PR B4 — Cupid relationship + chained death spike 🚧

目标：

- RuleState；
- relationships；
- typed RuleEffect；
- recursive death resolver。

不进入正式板子。

### PR B4.1 — RuleEffect contract hardening

在 B4 测试通过后，整理：

- effect union；
- ordering policy；
- resolver queue；
- death vs interaction continuation；
- victory-check boundary。

暂不急着实现丘比特第三阵营。

### PR B4.5 — Reference RuleSpec / Effect / Resolver audit

重点拆解 `WerewolfGameJudge`：

- wolfRobot（机械狼）；
- wildChild；
- wolfQueen；
- hunter；
- thief；
- piper。

产出：本项目 RoleDefinition V2 设计。

### PR B5 — Mechanical Wolf spike

验证：

```text
baseRole != effective abilities
```

实现最低可验证路径：

- learn / copy ability；
- persistent granted ability；
- dynamic NightPlan；
- private information exposure。

### PR B6 — RoleDefinition V2

根据 B4/B5 结果，把：

```text
metadata + interaction + hooks
```

升级为：

```text
abilities + interactions + effects + resources + hooks
```

保持向后兼容迁移，不做一次性全角色重写。

### PR B7 — Registry-driven NightPlan runtime

移除 legacy `NIGHT_ORDER` 作为生产权威。

正式流程由 RoleSpec / NightPlan 驱动。

### PR B8 — Script / Board V2

- preset scripts；
- rulesetId；
- validation；
- board coverage contract；
- 支持复杂角色板子。

---

## Phase 2 — Cloudflare Runtime Migration

规则引擎稳定后再把权威状态迁到 DO。

### PR C — Minimal Cloudflare GameRoom

- room routing；
- Durable Object storage；
- health / create / join；
- GameModule state persistence。

### PR C2 — Hibernation WebSocket

- user tags；
- unicast / broadcast；
- wake/resume。

### PR C3 — commandId + revision + snapshot

- idempotency；
- stale revision handling；
- atomic mutation。

### PR D — Reconnect

- player identity；
- last room；
- reconnect token；
- snapshot recovery。

### PR D2 — Capability / Host Recovery

Host 仍是玩家；异常恢复使用独立 capability，不扩大 HostView。

### PR D3 — WeChat Mini Program Adapter

- transport adapter；
- vibration/audio capability；
- lifecycle / reconnect。

---

## Phase 3 — BotC Architecture Spike

不要一开始就实现完整 Trouble Brewing。

### PR E1 — BotC State Model

建立：

- BotCTruthState；
- BotCRuleState；
- RoleDefinition；
- ScriptDefinition；
- History。

### PR E2 — AbilityStatus + Poison/Drunk

用最小角色组合验证：

```text
Poisoner
Soldier
Imp
```

核心目标：

```text
role identity != ability functioning
```

### PR E3 — Registration Model

验证：

```text
Spy
Recluse
Investigator / Librarian / Chef 类信息
```

核心目标：

```text
actual identity != registered identity
```

### PR E4 — Information Pipeline + KnowledgeLedger

用：

```text
Fortune Teller
Empath
Undertaker
```

验证：

- truth candidates；
- legal information；
- shown information persistence；
- player-specific history。

### PR E5 — StorytellerPolicy

先 heuristic：

```text
legal options -> ranking -> chosen outcome
```

AI 只能做合法空间中的推荐。

### PR E6 — Day Event Pipeline

验证：

```text
nomination
vote
execution
death triggers
```

选 1～2 个典型角色测试，而不是一次实现全部角色。

### PR E7 — Role Transform

验证：

```text
Imp starpass
Scarlet Woman
```

核心目标：

```text
role transition history
current role
alignment
ability source
```

### PR E8 — Trouble Brewing vertical slice

此时才实现一个可完整玩的最小 Trouble Brewing 版本。

重点不是角色数量，而是：

- 完整夜间；
- 信息生成；
- 白天提名/处决；
- 自动说书人合法决策；
- reconnect；
- privacy。

---

# 22. 哪些事情现在不要做

暂不：

- 把全部狼人杀角色一次迁成新 DSL；
- 把所有复杂逻辑做成 JSON；
- 在 B4 就实现完整丘比特第三阵营；
- 在规则架构未稳定前上完整 BotC；
- 让 AI 直接修改游戏状态；
- 做 Event Sourcing；
- 建大型数据库账户系统；
- 把 BotC 专有概念放进 `core/`；
- 因为未来多游戏而重写现有 GameModule。

---

# 23. 关键架构判断

## 判断 1

现有 `GameModule` 是正确资产，应继续保护。

## 判断 2

平台与游戏规则的边界比“统一所有游戏规则”更重要。

## 判断 3

Board / Script 应数据化，但规则不应写进板子。

## 判断 4

RoleSpec + Effect + Resolver 是长期主路径，Hook 是复杂规则逃生口。

## 判断 5

B4 的 RuleState / RuleEffect 方向与成熟参考项目一致，可以继续。

## 判断 6

机械狼是验证“身份与能力分离”的关键角色，应在继续扩大量角色前完成。

## 判断 7

BotC 不能只看作“角色更多的狼人杀”；必须有 Truth / Registration / Information / Knowledge / Storyteller Decision 的专用分层。

## 判断 8

自动说书人算法必须建立在 deterministic legal rule engine 之上，不能让 LLM 直接决定什么是合法规则。

## 判断 9

主要规则引擎 ownership 迁移应在 Durable Objects 持久化格式最终定型前完成，否则会把 legacy `GamePhase` / `NIGHT_ORDER` 固化到云端。

---

# 24. 下一步

当前推荐顺序：

```text
完成 PR B4 本地验证
        ↓
B4.1 RuleEffect contract hardening
        ↓
B4.5 深拆参考项目 wolfRobot / wildChild / wolfQueen / thief / piper
        ↓
B5 机械狼 Architecture Spike
        ↓
B6 RoleDefinition V2
        ↓
B7 registry-driven NightPlan runtime
        ↓
B8 Script / Board V2
        ↓
Cloudflare PR C 系列
        ↓
BotC PR E 系列
```

如果 B4 或 B5 暴露 Effect/Resolver 设计不足，应优先修正规则模型，不为了赶进度继续堆角色。

长期目标不是做出“支持很多角色”的代码，而是做出：

> **新增板子只需组合 RoleId；新增常规角色主要增加 RoleSpec；新增复杂角色只扩展少量 Effect/Resolver；新增游戏只实现新的 GameModule，而 Room、Reconnect、Durable Objects 和客户端协议保持稳定。**
