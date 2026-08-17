# 无法官桌游主持平台：Cloudflare Durable Objects 迁移与长期架构设计 V2

> 项目：`Jazz0006/my-game-host-vibration`  
> 当前主分支：`main`  
> 当前系统：Node.js + TypeScript + Express + Socket.IO + 静态 Web 客户端  
> 目标平台：Cloudflare Workers + Durable Objects + Workers Static Assets  
> 文档版本：V2  
> 日期：2026-08-17

---

# 1. 文档目的

本文件不是单纯的“把 Node.js 服务器搬到 Cloudflare”的迁移说明。

它定义的是这个项目未来几年的长期架构方向：

1. 现有狼人杀无法官主持功能继续作为第一个正式游戏模块；
2. 后续加入《血染钟楼》等更多游戏；
3. 支持血染钟楼自动说书人及线索/信息推荐算法；
4. 客户端从当前浏览器扩展到：
   - Web
   - 微信小程序
   - Android App
   - iOS App
   - 未来其他客户端
5. 后端实时房间从单机 Node.js 内存模型迁移至 Cloudflare Durable Objects；
6. 保持核心游戏逻辑、推荐算法、通信协议与 Cloudflare 平台解耦；
7. 允许未来将部分复杂计算迁往 VM、Container、GPU 或外部 AI API，而无需重写游戏系统。

因此，本次迁移的真正目标是：

> **把当前“狼人杀网页程序”升级为一个多游戏、多客户端、可长期扩展的实时桌游主持平台。**

---

# 2. 当前系统审计结论

当前代码已经具备良好的基础：

```text
src/
├── domain/
│   ├── game.ts
│   ├── sessionToken.ts
│   └── testPrompt.ts
├── server.ts
public/
├── index.html
├── app.js
└── style.css
tests/
```

其中：

- `game.ts` 已经包含独立的狼人杀规则状态机；
- `server.ts` 当前承担房间、Socket.IO、断线恢复、广播、游戏命令路由；
- `app.js` 已经具备：
  - 房间创建/加入
  - localStorage session
  - 自动重连
  - resume
  - session replacement
  - 多种游戏状态 UI
  - 震动提醒
- 测试已经覆盖：
  - 房间管理
  - 玩家加入/退出
  - 房主转移
  - 座位顺序
  - 断线恢复
  - resume token
  - 游戏流程

目前最大的架构问题不是功能不足，而是：

```text
Room
+
Socket.IO
+
Node runtime
+
狼人杀 GameState
+
UI protocol
```

仍然有较强耦合。

如果直接把 `server.ts` 改写成 Durable Object，虽然短期能上线，但未来加入 BotC 和微信小程序时还会发生第二次大规模重构。

因此 V2 方案将“迁移平台”和“产品架构升级”一起考虑。

---

# 3. 长期产品架构目标

最终系统建议形成：

```text
                    ┌──────────────────────┐
                    │      Clients         │
                    │                      │
                    │ Web                  │
                    │ WeChat Mini Program  │
                    │ Android              │
                    │ iOS                  │
                    └──────────┬───────────┘
                               │
                        Game Protocol
                               │
                               ▼
                  ┌────────────────────────┐
                  │ Realtime Room Platform │
                  │                        │
                  │ Session                │
                  │ Room                   │
                  │ Connection             │
                  │ Event Log              │
                  │ Persistence            │
                  └──────────┬─────────────┘
                             │
                     GameModule Interface
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
 ┌─────────────────┐                  ┌─────────────────┐
 │ Werewolf Engine │                  │   BotC Engine   │
 └─────────────────┘                  └────────┬────────┘
                                              │
                                  Storyteller Context
                                              │
                                              ▼
                                 Recommendation Engine
                                              │
                            ┌─────────────────┴──────────────┐
                            ▼                                ▼
                  deterministic algorithm          AI / external service
```

这里最重要的是：

> Room、Game、Client、Recommendation、Cloudflare 必须分别成为独立概念。

---

# 4. 架构原则

## 4.1 Cloudflare 是运行平台，不是产品架构

核心代码不能写成：

```text
狼人杀逻辑 = Durable Object
BotC逻辑 = Durable Object
```

而应是：

```text
Game Engine
    ↓
被 Durable Object 调用
```

未来如果更换：

- AWS
- Fly.io
- Kubernetes
- 普通 Node VM
- 自建服务器

游戏核心不应重写。

---

## 4.2 Room 不理解具体游戏规则

Room 只负责：

- 玩家成员
- 房主权限
- 连接
- session
- 当前 game type
- game module
- persistence
- command routing
- event log

不负责：

- 狼人夜间行动顺序
- 女巫解药逻辑
- BotC 投毒规则
- BotC 信息生成

---

## 4.3 游戏规则和智能推荐必须分离

尤其对 BotC：

```text
Rules Engine
```

回答：

- 什么操作合法？
- 当前真实状态是什么？
- 谁醉酒？
- 谁中毒？
- 谁死亡？
- 某角色此时应该获得什么种类的信息？

而：

```text
Recommendation Engine
```

回答：

- 应该具体展示哪一组信息？
- 哪个结果更适合当前局面？
- 如何维持玩家认知一致性？
- 怎样避免过度帮助某一阵营？
- 哪条线索在全局信息结构下更合理？

这两个系统不可混为一体。

---

## 4.4 客户端协议必须平台无关

服务器不能依赖：

- DOM
- `navigator.vibrate`
- `localStorage`
- Socket.IO
- 微信 API
- Android API
- iOS API

协议只描述：

- command
- state
- event
- acknowledgement
- session
- capabilities

---

## 4.5 所有关键状态变化应可追踪

未来 BotC 自动说书人、算法调试和重放都需要：

```text
Snapshot
+
Event Log
```

而不应只保存“当前状态”。

---

# 5. 多游戏架构

## 5.1 GameModule

建议定义统一接口：

```ts
export interface GameModule<
  TState,
  TCommand,
  TPlayerView,
  THostView
> {
  type: string;

  createGame(input: CreateGameInput): TState;

  handleCommand(
    state: TState,
    context: GameCommandContext,
    command: TCommand
  ): GameCommandResult<TState>;

  getPlayerView(
    state: TState,
    playerId: string
  ): TPlayerView;

  getHostView(
    state: TState
  ): THostView;

  getPublicView(
    state: TState
  ): unknown;
}
```

第一批：

```text
GameModule
├── werewolf
└── botc
```

以后可以扩展：

```text
├── avalon
├── one-night-werewolf
├── resistance
└── custom scripts
```

---

# 6. 狼人杀模块

当前 `src/domain/game.ts` 应逐步改造为：

```text
packages/games/werewolf/
├── engine.ts
├── state.ts
├── commands.ts
├── views.ts
└── rules.ts
```

第一阶段不必立即拆目录，但目标边界必须明确。

狼人杀模块继续负责：

- 角色配置
- 发牌
- 夜间流程
- 女巫
- 守卫
- 预言家
- 猎人
- 投票
- PK
- 胜负判断

Room 不知道这些细节。

---

# 7. 血染钟楼模块

BotC 与狼人杀相比复杂得多。

建议分为：

```text
BotC
├── Script Definition
├── Role Engine
├── Game State
├── Information Model
├── Player Knowledge Model
├── Storyteller State
└── Recommendation Engine
```

---

## 7.1 Script Definition

角色不能写死在代码中。

使用 JSON/TS schema：

```json
{
  "id": "trouble-brewing",
  "name": "暗流涌动",
  "roles": [
    "washerwoman",
    "librarian",
    "investigator",
    "chef",
    "empath",
    "fortune_teller",
    "undertaker",
    "monk",
    "ravenkeeper",
    "virgin",
    "slayer",
    "soldier",
    "mayor",
    "butler",
    "drunk",
    "recluse",
    "saint",
    "poisoner",
    "spy",
    "scarlet_woman",
    "baron",
    "imp"
  ]
}
```

未来：

```text
trouble-brewing
custom-advanced
bad-moon-rising
sects-and-violets
```

不需要修改 Room 或客户端协议。

---

## 7.2 BotC Rule Engine

负责：

```text
角色能力
夜间行动
醉酒
中毒
死亡
保护
恶魔转移
身份视角
信息是否合法
```

只输出确定性规则结果。

---

## 7.3 Player Knowledge Model

建议未来建立：

```ts
PlayerKnowledgeState
```

记录：

- 玩家被告知的身份
- 玩家收到过的信息
- 玩家看到过的候选
- 信息来源
- 信息发生时间
- 当前理论上可能推导出的事实范围

这是自动说书人算法的重要基础。

---

# 8. 自动说书人推荐架构

建议：

```text
BotC GameState
      │
      ├── Truth State
      │
      ├── Player Knowledge
      │
      ├── History
      │
      └── Script
      │
      ▼
RecommendationContext
      │
      ▼
Recommendation Engine
```

输出：

```ts
type Recommendation = {
  candidate: unknown;
  score: number;
  reasons: RecommendationReason[];
  constraintsSatisfied: string[];
};
```

推荐引擎第一阶段可以继续使用纯算法。

未来可以加入：

```text
Algorithm V1
Algorithm V2
Algorithm V3
LLM assisted
Monte Carlo
Search based
Hybrid
```

而不修改 BotC Rules Engine。

---

# 9. Recommendation Service

不建议所有智能算法永久放在 Durable Object 中。

第一阶段：

```text
DO
 ↓
本地 TypeScript RecommendationEngine
```

未来：

```text
Room DO
   ↓
Recommendation API
   ├── Worker
   ├── Oracle VM
   ├── Python service
   ├── GPU container
   └── AI API
```

Room DO 是权威状态源。

Recommendation Service 只读取必要上下文并返回建议，不成为权威游戏状态。

---

# 10. 多客户端架构

长期客户端：

```text
Clients
├── Web
├── WeChat Mini Program
├── Android
└── iOS
```

它们必须共享同一个：

```text
Game Protocol
```

---

# 11. Game Protocol

正式定义版本化协议：

```ts
type ProtocolEnvelope =
  | CommandMessage
  | AckMessage
  | EventMessage
  | AuthMessage;
```

例如：

```json
{
  "protocolVersion": 1,
  "kind": "command",
  "id": "req-123",
  "event": "player.submitVote",
  "data": {
    "actionId": "abc",
    "targetId": "player-7"
  }
}
```

Ack：

```json
{
  "protocolVersion": 1,
  "kind": "ack",
  "id": "req-123",
  "result": {
    "ok": true
  }
}
```

Server Event：

```json
{
  "protocolVersion": 1,
  "kind": "event",
  "event": "room.state",
  "data": {}
}
```

---

# 12. 协议版本

协议必须从第一版就加入：

```text
protocolVersion
```

原因：

以后会同时存在：

```text
旧 Web 客户端
新 Web 客户端
微信小程序旧版本
Android 新版本
```

不能假定所有客户端同时升级。

第一阶段可以只支持：

```text
v1
```

但数据结构必须允许版本协商。

---

# 13. ClientCapabilities

客户端连接后发送：

```json
{
  "kind": "client.hello",
  "protocolVersion": 1,
  "client": {
    "platform": "web",
    "version": "1.0.0"
  },
  "capabilities": {
    "vibration": true,
    "audio": true,
    "backgroundRealtime": false,
    "pushNotification": false
  }
}
```

未来微信：

```json
{
  "client": {
    "platform": "wechat-mini-program"
  }
}
```

Android：

```json
{
  "client": {
    "platform": "android-native"
  }
}
```

---

# 14. Capability-based behavior

服务器不要写：

```ts
if (platform === "wechat") ...
```

而是：

```ts
if (capabilities.vibration) ...
```

未来通知策略可以变成：

```text
action required
   │
   ├── vibration supported → vibrate
   ├── audio supported → short audio
   ├── push supported → push
   └── foreground only → UI warning
```

---

# 15. Client SDK

建议未来建立：

```text
packages/
├── protocol/
├── client-core/
├── games/
│   ├── werewolf/
│   └── botc/
```

`client-core` 负责：

- session
- reconnect
- auth
- command ID
- ack timeout
- protocol parsing
- state synchronization
- session replacement
- connection lifecycle

---

# 16. Transport Adapter

各平台只实现 transport：

```text
client-core
     │
     ├── BrowserWebSocketAdapter
     ├── WeChatWebSocketAdapter
     ├── AndroidWebSocketAdapter
     └── iOSWebSocketAdapter
```

游戏 UI 不直接调用平台 socket API。

---

# 17. Cloudflare 目标架构

```text
                     GitHub
                       │
                 Workers Builds
                       │
                       ▼
         ┌────────────────────────────┐
         │ Cloudflare Worker          │
         │                            │
         │ Static Assets              │
         │ REST bootstrap             │
         │ API routing                │
         └──────────────┬─────────────┘
                        │
                 idFromName(roomId)
                        │
                        ▼
              ┌──────────────────┐
              │ RoomDurableObject│
              │                  │
              │ Room Core        │
              │ Session          │
              │ WebSockets       │
              │ GameModule       │
              │ EventLog         │
              │ Snapshot         │
              └────────┬─────────┘
                       │
             optional recommendation call
                       │
                       ▼
              Recommendation Service
```

---

# 18. Durable Object 职责

RoomDurableObject 只负责：

```text
房间
成员
连接
身份
权限
持久化
消息路由
GameModule lifecycle
EventLog
广播
```

不直接实现：

```text
狼人杀规则
BotC角色规则
推荐算法
客户端UI
```

---

# 19. Persistent Room

建议：

```ts
type PersistentRoom = {
  schemaVersion: number;
  roomId: string;
  gameType: string;
  createdAt: number;
  updatedAt: number;

  players: PersistentPlayer[];

  gameState?: unknown;

  metadata?: Record<string, unknown>;
};
```

---

# 20. 不持久化 socketId

旧结构中的：

```text
socketId
connected
```

不应该成为 Durable State。

持久化：

```text
playerId
name
seat
isHost
resumeTokenHash
```

在线状态从：

```text
ctx.getWebSockets()
+
WebSocket attachment
```

动态得出。

---

# 21. WebSocket Hibernation

使用：

```text
Hibernation WebSocket API
```

必须遵循：

```text
durable state → storage
connection identity → attachment
temporary runtime state → cache only
```

绝不能依赖：

```ts
this.connections
```

在 Durable Object 生命周期中永久存在。

---

# 22. Session / Resume

客户端本地保存：

```text
roomId
playerId
resumeToken
```

恢复：

```text
connect room WS
 ↓
auth
 ↓
verify token
 ↓
replace old connection if needed
 ↓
room state
 ↓
private game state
 ↓
pending action alert
```

保持当前行为：

- 原座位
- 原权限
- 不重复玩家
- 旧连接被替换
- pending prompt 恢复
- 当前行动恢复

---

# 23. 创建房间

建议使用 HTTP bootstrap：

```text
POST /api/rooms
```

返回：

```json
{
  "roomId": "123456",
  "playerId": "...",
  "resumeToken": "...",
  "seat": 1
}
```

随后建立：

```text
/api/rooms/123456/ws
```

---

# 24. 加入房间

```text
POST /api/rooms/:roomId/join
```

DO 检查：

- 是否存在
- 游戏是否开始
- 人数限制
- 名称
- 游戏类型允许的 player count

返回 session 后建立 WebSocket。

---

# 25. GameEvent

建议加入：

```ts
type GameEvent = {
  id: string;
  seq: number;
  timestamp: number;
  type: string;
  actorId?: string;
  targetId?: string;
  payload?: unknown;
};
```

例如：

```text
room.created
player.joined
player.left
game.started
role.assigned
night.started
werewolf.targetSelected
vote.cast
player.executed
botc.poisonApplied
botc.infoGenerated
botc.infoShown
game.ended
```

---

# 26. Event Log 的价值

GameEvent 同时服务：

1. Debug
2. 断线恢复审计
3. 游戏回放
4. 算法复现
5. 推荐算法评估
6. 数据分析
7. Bug report
8. 自动测试
9. 未来 AI 训练数据

因此建议现在就建立基础模型。

---

# 27. Snapshot + Event Log

第一版：

```text
Persistent Snapshot
+
Append-only Event Log
```

不要求完整 Event Sourcing。

权威状态仍然是 Snapshot。

EventLog 主要承担：

```text
历史
解释
审计
回放
```

---

# 28. 房间生命周期

建议：

```text
host close
 → notify
 → socket close
 → deleteAll
```

最后玩家主动离开：

```text
empty room
 → deleteAll
```

异常遗留：

```text
updatedAt
+
DO Alarm
+
TTL
```

推荐 TTL 参数化：

```text
ROOM_TTL_HOURS
```

而不是写死。

---

# 29. 前端静态资源

推荐：

```text
Worker
+
Workers Static Assets
```

而不是额外拆一个 Pages 项目。

```text
/
/app.js
/style.css
```

直接静态资源。

```text
/api/*
```

进入 Worker。

---

# 30. 项目目录长期建议

```text
apps/
├── web/
├── wechat-mini/
├── android/
└── ios/

packages/
├── protocol/
├── client-core/
├── room-core/
├── common/
├── games/
│   ├── werewolf/
│   └── botc/
└── storyteller/
    └── recommendation/

backend/
├── cloudflare/
│   ├── worker.ts
│   ├── RoomDurableObject.ts
│   └── storage/
└── node/
    └── server.ts
```

当前项目无需一次重构成 monorepo。

这是长期目标结构。

---

# 31. 迁移阶段总览 V2

新版实施路线：

```text
ARCH-0  Architecture foundation
ARCH-1  Protocol abstraction
ARCH-2  Client transport abstraction
CF-0    Cloudflare skeleton
CF-1    Durable Room
CF-2    WebSocket / Hibernation
CF-3    Werewolf migration
CF-4    EventLog / persistence
CF-5    Production deployment
BOTC-0  BotC GameModule foundation
BOTC-1  Script/Role engine
BOTC-2  Knowledge model
BOTC-3  Recommendation integration
CLIENT-1 WeChat Mini Program
CLIENT-2 Native apps
```

---

# 32. ARCH-0 — Core Architecture Foundation

目标：

**在不改变现有产品行为的情况下，把业务结构从 Node/Socket.IO 中拆出来。**

任务：

1. 提取 `RoomCore`
2. 定义 `GameModule`
3. 将现有狼人杀包装为 `WerewolfGameModule`
4. 抽离：
   - room view
   - player view
   - host view
5. random provider
6. Web Crypto session token
7. GameEvent 基础类型
8. 所有当前测试继续通过

本阶段禁止：

- Cloudflare 代码
- UI 重写
- 游戏规则改动

---

# 33. ARCH-1 — Versioned Game Protocol

定义：

```text
protocolVersion
command
ack
event
auth
client.hello
capabilities
```

把当前：

```text
host:create-room
player:join-room
player:resume
...
```

转成正式 protocol event names。

可以暂时保留兼容映射。

---

# 34. ARCH-2 — Client Core

建立：

```text
RealtimeClient
SessionManager
ReconnectManager
CommandTracker
```

现有 Web UI 从：

```js
socket.emit()
socket.on()
```

切换为：

```js
client.command()
client.on()
```

底层第一版仍可使用 Socket.IO。

---

# 35. CF-0 — Worker Skeleton

加入：

```text
wrangler
worker entry
static assets
health endpoint
Durable Object binding
```

但不迁完整游戏。

---

# 36. CF-1 — Durable Room

迁移：

- create
- join
- rename
- seat order
- transfer host
- remove player
- leave
- close room
- persistence
- TTL

---

# 37. CF-2 — Native WebSocket

实现：

- WebSocket upgrade
- auth
- attachment
- Hibernation
- ack protocol
- reconnect
- session replacement

---

# 38. CF-3 — Werewolf GameModule Migration

迁移当前游戏命令：

```text
start game
confirm role
start night
guard
werewolf
witch
seer
hunter
vote
PK
game over
restart
```

原则：

> 迁移 orchestration，不重写 rules engine。

---

# 39. CF-4 — EventLog / Durable Persistence

正式实现：

```text
room snapshot
event sequence
updatedAt
TTL alarm
schemaVersion
```

---

# 40. CF-5 — Cloudflare Production

部署：

```text
Workers Static Assets
Durable Objects
GitHub Workers Builds
Preview deployments
production main
```

Oracle VM 暂时保留 fallback。

---

# 41. BOTC-0 — BotC Module Foundation

完成：

```text
BotCGameModule
BotCGameState
ScriptDefinition
RoleDefinition
```

支持：

```text
JSON script import
```

---

# 42. BOTC-1 — Role/Rule Engine

实现第一批角色机制。

优先：

```text
Trouble Brewing
+
当前自定义进阶小剧本
```

所有规则必须独立于客户端。

---

# 43. BOTC-2 — Knowledge Model

加入：

```text
TruthState
PlayerKnowledgeState
InformationHistory
```

为自动说书人推荐服务。

---

# 44. BOTC-3 — Recommendation Engine Integration

推荐系统通过统一接口：

```ts
interface StorytellerRecommendationEngine {
  recommend(context: RecommendationContext): Promise<Recommendation[]>;
}
```

第一版：

```text
local deterministic
```

未来：

```text
remote compute / AI
```

---

# 45. CLIENT-1 — 微信小程序

客户端只实现：

```text
UI
WeChat transport adapter
platform capabilities
local session storage
vibration/audio integration
```

不重新实现：

```text
game rules
room rules
protocol
resume state machine
```

---

# 46. CLIENT-2 — Android / iOS

同样遵循：

```text
Client Core
+
Native Transport / Native Alert
```

---

# 47. 测试架构

长期测试分四层。

## Layer 1 — Game Engine

```text
Werewolf rules
BotC rules
```

纯 TypeScript。

---

## Layer 2 — Room Core

测试：

```text
members
permissions
seat
host
session
```

不依赖 Cloudflare。

---

## Layer 3 — Protocol Contract

同一组场景测试：

```text
Node transport
Cloudflare transport
```

确保行为一致。

---

## Layer 4 — End-to-End

真实：

```text
browser
wechat
android
cloudflare
```

---

# 48. 必须保留的当前恢复测试

迁移后仍必须通过：

- token 不进入 room state
- 恢复同一 playerId
- 恢复原 seat
- host 权限恢复
- pending private prompt 恢复
- invalid token 拒绝
- 新连接替换旧连接
- 旧连接断开不能把新连接标记 offline

---

# 49. 安全设计

基础要求：

```text
resumeToken only returned to owner
server stores hash only
token never broadcast
token not in WebSocket URL
host commands always server-authorized
player commands always bound to authenticated player
actionId prevents stale submission
protocol payload validation
```

未来建议：

```text
rate limiting
room creation abuse protection
schema validation
security event log
```

---

# 50. 数据版本

必须加入：

```text
schemaVersion
```

原因：

以后 Durable Object 中可能存在正在进行的旧版游戏。

例如：

```text
schemaVersion: 1
```

未来升级时：

```text
v1 → v2 migration
```

不能假设 deploy 后 storage 自动匹配新代码。

---

# 51. GameModule Version

未来游戏也应版本化：

```text
gameType: botc
gameVersion: 2
scriptVersion: 5
```

用于：

- 旧局恢复
- Bug复现
- 回放
- 推荐算法比较

---

# 52. Recommendation Version

推荐结果记录：

```text
engineId
engineVersion
```

例如：

```json
{
  "engineId": "botc-consistency",
  "engineVersion": "v4"
}
```

这样以后能重放同一局比较：

```text
v3
vs
v4
```

---

# 53. 未来复杂计算

如果 BotC 推荐计算变重：

```text
Cloudflare DO
      │
      ▼
Recommendation Service
```

Recommendation Service 可以部署在：

```text
Oracle VM
AWS
Fly.io
GPU provider
OpenAI API
local model service
```

DO 只负责：

```text
send context
receive recommendation
validate
record event
```

---

# 54. 为什么现在仍然推荐 Durable Objects

针对当前实际负载：

```text
5–12 人
实时 WebSocket
房间级共享状态
大量空闲等待
少量操作
高断线恢复要求
```

Durable Object 的：

```text
single room authority
persistent storage
WebSocket hibernation
automatic routing
serverless operations
```

与产品需求高度匹配。

但是：

> **所有核心业务代码必须保持平台中立。**

---

# 55. 迁移原则

整个项目实施过程中遵循：

### 原则 A
每个阶段都保持可运行。

### 原则 B
Cloudflare migration 不修改游戏规则。

### 原则 C
先解耦，再迁移。

### 原则 D
协议先于多客户端。

### 原则 E
GameModule 先于 BotC。

### 原则 F
Knowledge Model 先于复杂推荐算法。

### 原则 G
Snapshot 与 EventLog 同时保留。

### 原则 H
DO 保持薄，不变成万能类。

---

# 56. 当前最推荐的下一步

不是立即写：

```text
RoomDurableObject.ts
```

而是先实施：

# `ARCH-0 — Core Architecture Foundation`

具体：

1. 定义 `RoomCore`
2. 定义 `GameModule`
3. 将现有狼人杀包装为 `WerewolfGameModule`
4. 抽出 platform-neutral random
5. 改造 Web Crypto session token
6. 定义 GameEvent 基础
7. 保持当前 Node + Socket.IO 部署和 UI 完全可用
8. 所有测试通过

ARCH-0 完成后：

```text
当前产品仍然正常
+
架构已经支持未来 BotC
+
不再把 Cloudflare 写进核心
```

然后再进入：

```text
ARCH-1 Protocol
ARCH-2 Client Core
CF migration
```

---

# 57. 最终目标

当本轮架构升级完成后，理想状态是：

```text
                      Platform
                         │
              Cloudflare Durable Objects
                         │
                         ▼
                    Room Core
                         │
                 GameModule API
             ┌───────────┴───────────┐
             ▼                       ▼
         Werewolf                  BotC
                                      │
                                      ▼
                            Recommendation Engine

Clients
├── Web
├── WeChat Mini Program
├── Android
└── iOS
        │
        ▼
  Shared Game Protocol
```

到这个阶段以后：

- 新增游戏，不改 Room；
- 新增客户端，不改 Game；
- 新增说书人算法，不改 BotC Rules；
- 更换 Cloudflare，不改游戏核心；
- 升级推荐算法，可以重放旧 GameEvent；
- 服务器更新后，已有房间仍然可以恢复。

这才是本次 Durable Objects 迁移真正应该达到的长期价值。
