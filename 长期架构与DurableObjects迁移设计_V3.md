# 无法官桌游主持平台：Cloudflare Durable Objects 长期架构与源码借鉴实施方案 V3

> 项目：`Jazz0006/my-game-host-vibration`  
> 主分支：`main`  
> 当前系统：Node.js + TypeScript + Express + Socket.IO + Web 客户端  
> 目标平台：Cloudflare Workers + Durable Objects + Web/微信小程序客户端  
> 参考项目：`olveryu/WerewolfGameJudge`  
> 文档版本：V3  
> 日期：2026-08-17

---

# 1. 文档定位

本文件取代旧版 `长期架构与DurableObjects迁移设计_V2.md`，作为 `my-game-host-vibration` 后续实施的主设计基线。

V3 最重要的修正，是重新明确产品边界：

- `CampBoardGameHost` 是独立的 Android 离线主持工具；
- `my-game-host-vibration` 是联网、多玩家、多手机、无真人法官的自动主持系统；
- 两者可以在未来共享角色数据、规则知识或部分算法，但不是同一个运行系统，也不以共享运行时为前提。

本项目的目标不是“把 Android 项目搬到云端”，也不是“先做一个完整通用游戏平台”。

真正目标是：

> **先做出一个在朋友线下聚会中真正好用、可靠、低干扰的狼人杀自动主持系统，同时让架构能够自然扩展到 Blood on the Clocktower（血染钟楼）。**

---

# 2. 产品目标与核心体验

`my-game-host-vibration` 面向的是朋友面对面聚会场景：

- 每名玩家有一台手机；
- 游戏依赖网络；
- 讨论、发言、社交推理仍在线下完成；
- 手机只承担身份、秘密信息、夜间行动、提醒和少量控制；
- 系统自动主持，因此不需要牺牲一名玩家当法官；
- 房主不承担日常主持工作，只保留异常恢复与管理能力。

核心体验优先级如下：

1. 没有真人法官，所有人都能玩；
2. 线下面对面交流仍然是主体；
3. 手机尽量少操作、少注视；
4. 使用震动只唤醒真正需要行动的玩家；
5. 夜间只运行本局实际存在的行动，跳过无意义环节；
6. 语音只作为辅助，不作为主要主持机制；
7. 熄屏、切 App、浏览器暂停、Wi-Fi/蜂窝网络切换都视为正常生命周期；
8. 断线恢复必须简单、快速、可靠；
9. 房主拥有异常恢复能力；
10. V1 先做好狼人杀，但平台核心不可硬编码成狼人杀。

---

# 3. 与 CampBoardGameHost 的边界

## 3.1 CampBoardGameHost

定位：

```text
Android Offline Host Tool
真人主持人 / 说书人 + 一台手机
无网络也能玩
重点：简单、离线、可靠、低门槛
```

适用场景包括露营等无网络环境。

## 3.2 my-game-host-vibration

定位：

```text
Cloud Online Automatic Host
每名玩家一台手机
系统自动主持
重点：无人法官、震动提醒、快速夜间、可靠重连
```

## 3.3 两者关系

允许未来共享：

- 角色定义；
- 规则知识；
- JSON 剧本；
- 某些纯算法；
- BotC 角色/剧本元数据。

但不强制共享：

- Room Runtime；
- Connection；
- WebSocket；
- Reconnect；
- Android UI；
- Cloudflare Runtime。

结论：

> **共享是机会，不是架构前提。**

---

# 4. V1 游戏范围

V1 以狼人杀为正式交付目标。

原因：

- 当前已有完整度较高的狼人杀规则与流程；
- 可以用较低复杂度验证多人房间、秘密行动、震动、重连和异常恢复；
- Blood on the Clocktower 的状态、角色能力、信息生成和说书人决策复杂度明显更高；
- 如果直接以 BotC 为第一版目标，会把平台、规则、推荐算法和 UI 风险同时叠加。

但 V1 架构必须满足：

```text
GameRoom
Player
GameState
GameCommand
GameModule
PlayerView
HostView
PendingInteraction
```

这些概念不能以 `WerewolfRoom`、`WerewolfPlayer` 等方式写死在平台层。

---

# 5. 当前代码基础

当前仓库已经有良好的分层基础：

```text
src/
├── core/
├── domain/
├── games/
│   └── werewolf/
│       └── WerewolfGameModule.ts
├── runtime/
│   └── node/
└── server.ts
```

现有 `GameModule` 已经定义：

- `createGame()`；
- `handleCommand()`；
- `getPlayerView()`；
- `getHostView()`；
- `getPublicView()`。

因此 V3 不再安排一次“大规模抽 Game Contract”的重构。

新的原则是：

> **保护现有 GameModule 抽象，补齐它需要的 Interaction、Cloud Room、Reconnect 和 Host Recovery 能力。**

---

# 6. 总体架构

```text
                  my-game-host-vibration
                           │
                    Cloudflare Worker
                           │
                     Room Routing
                           │
                    GameRoom Durable Object
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
   Room Platform       GameModule        Realtime
         │                 │                 │
    Membership         Werewolf         WebSocket
    Session            BotC later       Snapshot
    Revision                            Private Event
    CommandId
    HostControl
                           │
                    Night Orchestrator
                           │
                     Interaction
                           │
              ┌────────────┴────────────┐
              │                         │
          Web Client            WeChat Mini Program
              │                  ┌──────┴──────┐
              │                  │             │
       Browser Capability    Native Shell    WebView
              │                  │             │
         vibration          vibration      Game UI
         audio              lifecycle
                            reconnect
```

---

# 7. 对 WerewolfGameJudge 的复用原则

参考项目：`olveryu/WerewolfGameJudge`

它与本项目在以下方面高度相似：

- 多玩家在线房间；
- Cloudflare Worker；
- Durable Objects；
- WebSocket；
- 一个房间一个权威状态；
- 多游戏模块；
- Web 与微信小程序；
- 断线恢复；
- 玩家私有信息。

因此不应重新设计一整套云端多人基础设施。

但也不应该完整 Fork 并替换当前项目。

原则：

> **CampBoardGameHost / my-game-host-vibration 保留自己的产品、规则、交互和差异化设计；WerewolfGameJudge 主要作为成熟 Cloud Platform 参考实现和可选择代码来源。**

---

# 8. A 级复用：高度值得直接借鉴

## 8.1 一个房间一个 Durable Object

采用：

```text
roomCode -> GameRoom Durable Object
```

GameRoom 是房间的唯一权威状态来源。

它负责：

- 房间生命周期；
- 玩家成员关系；
- 当前游戏状态；
- command dispatch；
- revision；
- snapshot；
- WebSocket；
- 广播和定向消息。

不负责：

- 狼人夜间顺序；
- 女巫规则；
- 预言家查验；
- BotC 投毒；
- BotC 说书人推荐。

## 8.2 Durable Object Hibernation WebSocket

参考 `GameRoomRuntime.ts` 的：

- `ctx.acceptWebSocket()`；
- `ctx.getWebSockets()`；
- WebSocket tags；
- `setWebSocketAutoResponse()`。

Cloudflare 端直接按 Hibernation WebSocket 模式实现，不先做一版长驻 WebSocket 再迁移。

## 8.3 User WebSocket Tag

初期使用：

```text
user:<userId>
```

从而支持：

- 全房间广播；
- 指定玩家 unicast；
- 后续按需求扩展角色组或狼人组。

## 8.4 Snapshot + Revision

服务端维护：

```text
revision: integer
snapshot: authoritative state
```

客户端恢复时直接获取当前 snapshot，而不是回放完整历史事件。

V1 不做 Event Sourcing。

## 8.5 commandId 与幂等

每个客户端命令带唯一 `commandId`。

同一个 `commandId` 重复提交时：

- 不再次执行规则；
- 返回原执行结果或当前确认结果。

这是手机网络切换场景下必须具备的可靠性基础。

---

# 9. B 级复用：借设计，做精简版

## 9.1 Runtime GameModule

WerewolfGameJudge 的 Runtime GameModule 包含：

- state version；
- schema parse；
- internal/public command；
- effects；
- statistics；
- external side effects。

本项目当前无需全部复制。

现有 `GameModule` 已经更适合当前阶段，应继续保留。

未来只在确有需要时补：

```text
getPendingInteractions()
或
getActiveInteraction()
```

## 9.2 RoomRepository / actionPipeline

借鉴：

- atomic command；
- revision 增长；
- idempotency；
- validation；
- state 持久化边界。

不直接复制所有复杂逻辑。

---

# 10. C 级：V1 暂不引入

以下模块目前不进入主路径：

- Effect Outbox；
- 完整 D1 UserEvent Inbox；
- R2；
- 深度 Sentry/Telemetry；
- Statistics；
- 用户账户体系；
- 排行榜；
- 历史战绩；
- 订阅/支付；
- 复杂 Room Saga；
- 大型数据库 migration framework。

V1 的基础设施目标控制在：

```text
Durable Object Storage
+ WebSocket
+ Snapshot
+ Revision
+ commandId
+ Room Identity
```

---

# 11. 核心差异化：Night Orchestrator

这是本项目区别于普通在线狼人杀产品的核心。

传统自动主持往往按固定语音脚本运行：

```text
狼人请睁眼
等待
狼人请闭眼
预言家请睁眼
等待
女巫请睁眼
...
```

本项目应采用 Event-driven Night：

```text
GameState
   ↓
Night Orchestrator
   ↓
只生成本局实际存在的 Interaction
   ↓
只唤醒真正需要行动的玩家
```

例如本局没有女巫，则不生成任何女巫阶段，也不产生等待。

最终体验目标：

> **夜间耗时尽量接近真实有效操作总时间，而不是固定主持脚本总长度。**

---

# 12. Phase 与 Interaction 分离

当前狼人杀状态中存在类似：

```text
night_guard
night_werewolf
night_witch
night_seer
night_complete
```

V1 可以继续保留已有 phase，以降低重构成本。

但长期要区分：

```text
Game Phase
```

与：

```text
Player Interaction
```

例如：

```text
phase = night

activeInteraction = {
  kind: "seer_check",
  actors: ["P6"]
}
```

这样才能自然支持 BotC 的动态夜间能力。

---

# 13. PendingInteraction 建议模型

V1 推荐从简单模型开始：

```ts
type PendingInteraction = {
  id: string;
  kind: string;
  actorPlayerIds: string[];
  mode: "single" | "group";
  wakePolicy: {
    vibrate: boolean;
    audioCue?: string;
  };
  status: "pending" | "active" | "completed";
};
```

狼人示例：

```text
kind: wolf_kill
actors: [P1, P4]
mode: group
vibrate: true
audioCue: wolf_wake (可选)
```

预言家示例：

```text
kind: seer_check
actors: [P6]
mode: single
vibrate: true
audioCue: none
```

---

# 14. 狼人多人行动策略

狼人阶段不需要复杂的在线多人投票协议。

真实流程：

```text
所有狼人手机震动
      ↓
狼人现实中睁眼并交流
      ↓
任意一名狼人使用手机提交目标
      ↓
服务器记录
      ↓
其他狼人看到已选结果
```

V1 可以采用：

- 第一个有效提交生效；或
- 在确认前允许覆盖最后一次选择。

不需要第一版实现：

- distributed consensus；
- 狼人内部在线聊天室；
- 多数票统计；
- 复杂冲突解决。

---

# 15. 震动能力必须平台化

GameModule 不应该直接调用：

```js
navigator.vibrate()
```

游戏层只描述语义事件：

```text
WAKE_PLAYER
WAKE_GROUP
OPTIONAL_AUDIO_CUE
```

客户端通过 Capability Adapter 执行。

建议接口概念：

```ts
interface DeviceCapabilities {
  vibrate(pattern: VibrationPattern): Promise<void>;
  playAudio?(cue: AudioCue): Promise<void>;
}
```

不同客户端实现：

```text
Android Browser -> navigator.vibrate()
WeChat Mini Program -> wx.vibrateShort / wx.vibrateLong
Future Android App -> Android Vibrator API
Future iOS App -> Native Haptics
```

---

# 16. 语音定位

震动是核心，语音是辅助。

适合保留语音的场景：

- 狼人阶段；
- 公共流程提示；
- 必然存在且多人共同参与的环节；
- 需要维持桌面节奏的提示。

适合只震动不语音的场景：

- 预言家；
- 女巫；
- 单人秘密能力；
- 希望隐藏角色是否在场的环节。

原则：

> **音频不应该暴露不必要的信息，也不应该强迫不存在的角色产生等待时间。**

---

# 17. Reconnect 是核心平台能力

断线视为正常生命周期。

常见情况：

- 锁屏；
- 切微信；
- 切相机；
- 接电话；
- 浏览器被系统冻结；
- Wi-Fi 切换到蜂窝网络；
- WebSocket 被回收。

客户端保存：

```text
roomCode
playerId
sessionToken
lastRevision
```

恢复流程：

```text
onShow / online / socket close / page resume
        ↓
ReconnectManager
        ↓
重新建立连接
        ↓
认证 session
        ↓
获取 authoritative snapshot
        ↓
比较 revision
        ↓
直接恢复正确 UI
```

目标：

> 玩家恢复后不需要重新输入房间号、重新选座位或重新查看身份。

---

# 18. 重连后的震动去重

必须避免：

```text
reconnect -> vibrate
reconnect -> vibrate
reconnect -> vibrate
```

每个 Interaction 必须有稳定：

```text
interactionId
```

客户端记录：

```text
lastWakeInteractionId
```

只有第一次看到新的 active interaction 时自动震动。

房主如果需要再次提醒玩家，则产生一个新的提醒事件：

```text
wakeEventId
```

这允许：

- 自动提醒只发生一次；
- 房主可以人工“重新提醒”。

---

# 19. Host Control：异常恢复控制台

房主不是法官，而是 Recovery Controller。

正常游戏中房主不需要干预。

V1 最小能力：

1. 查看玩家在线/离线状态；
2. 查看当前 Interaction；
3. 重新提醒某个玩家；
4. 强制跳过当前 Action；
5. 重开本局；
6. 结束房间。

后续再增加：

- 修改误操作结果；
- 返回上一步；
- 恢复错误状态。

其中“回退”对状态机影响较大，不应成为第一版迁移的阻塞项。

---

# 20. 微信客户端：Thin Native Shell + WebView

微信客户端不采用完整原生 UI 重写。

推荐：

```text
WeChat Mini Program
       │
   ┌───┴────────────┐
   │                │
Native Shell      WebView
   │                │
vibration         Game UI
lifecycle         Room UI
network           Actions
reconnect         PlayerView
```

WebView 承担绝大多数界面和业务交互。

Native Shell 只承担 Web 不可靠或无法实现的设备能力：

- iPhone 震动；
- 小程序生命周期；
- 网络状态；
- 必要的重连辅助；
- 微信登录/分享等微信能力。

目标仍然是 90% 以上界面和业务逻辑复用 Web。

---

# 21. 微信震动不要依赖 WebView postMessage 主链路

不推荐关键提醒走：

```text
DO -> WebView -> postMessage -> Mini Program -> vibrate
```

推荐：

```text
              Durable Object
              /           \
             /             \
       Native Shell       WebView
           ↓                ↓
      Wake Event          Game State
           ↓                ↓
       Vibration           UI
```

Native Shell 只监听少量设备级事件：

- wake；
- vibrate；
- session invalid；
- room ended；
- reconnect required。

WebView 继续承担完整游戏 UI 和 PlayerView。

---

# 22. 目录演进建议

不为了目录美观进行一次大搬迁。

继续沿用当前结构，逐步演进：

```text
src/
├── core/
│   ├── game/
│   │   └── GameModule.ts
│   ├── protocol/
│   │   ├── commands.ts
│   │   ├── snapshot.ts
│   │   └── events.ts
│   └── interaction/
│       └── PendingInteraction.ts
│
├── games/
│   ├── werewolf/
│   │   ├── WerewolfGameModule.ts
│   │   └── WerewolfNightPlanner.ts
│   └── botc/              # 后续
│
├── runtime/
│   ├── node/              # 迁移期间保留
│   └── cloudflare/
│       ├── worker.ts
│       ├── GameRoom.ts
│       ├── RoomRepository.ts
│       └── RoomDirectory.ts
│
└── server.ts              # Cloudflare 稳定后退休
```

客户端当前 `public/` 可以继续使用。

不要在 Cloudflare 迁移同时做不必要的前端框架重写。

---

# 23. 实施路线：6 个核心 PR

## PR A — 固化现有 GameModule

目标：不是重写，而是确认和补齐现有抽象。

工作内容：

- GameModule 测试；
- WerewolfGameModule 测试；
- PlayerView 完整化；
- HostView 完整化；
- PublicView 完整化；
- 确认 GameState 不包含 connection/socket/session runtime 信息；
- 确保模块可在没有 Express、Socket.IO、Cloudflare 和 UI 的情况下独立运行完整局。

完成标准：

```ts
const game = module.createGame(...)
module.handleCommand(...)
module.handleCommand(...)
...
```

纯测试环境能够完成一局狼人杀。

---

## PR B — Night Interaction / Orchestrator

这是第一个真正新的核心能力。

新增：

- `PendingInteraction`；
- `interactionId`；
- `actorPlayerIds`；
- `wakePolicy`；
- `completionPolicy`；
- Werewolf Night Planner / Orchestrator。

至少覆盖：

- WolfKill；
- GuardProtect；
- WitchAction；
- SeerCheck；
- HunterShot。

完成标准：

- 没有女巫则不生成 WitchAction；
- 没有预言家则不生成 SeerCheck；
- 客户端不再依赖硬编码 phase 来判断自己是否要行动；
- 服务器可以明确告诉某玩家“你当前有 active interaction”。

---

## PR C — Minimal Cloudflare GameRoom

开始真正迁移到 Durable Objects。

参考 WerewolfGameJudge：

- GameRoomRuntime；
- RoomRepository；
- WebSocket tags；
- Snapshot；
- Revision；
- commandId。

第一版 GameRoom 只需要：

```text
initialize()
join()
dispatch()
getSnapshot()
connectWebSocket()
broadcast()
```

暂不引入：

- D1；
- Outbox；
- R2；
- stats；
- account；
- payment；
- AI。

---

## PR D — Reconnect Hardening

单独作为一个 PR，不当成小修补。

必须测试：

- 锁屏后恢复；
- 切 App 后恢复；
- Wi-Fi -> 5G；
- 浏览器刷新；
- WebSocket 主动断开；
- duplicate command；
- 玩家在 active interaction 中断线；
- interaction 已完成后恢复不能重复操作；
- host 重新提醒。

核心验收：

> 用户回来后不需要重新加入房间，当前身份和游戏状态正确恢复。

---

## PR E — Host Recovery Console

实现现场使用所需的异常恢复能力。

V1：

- 玩家在线状态；
- 当前 interaction；
- 重新提醒；
- 跳过当前 action；
- 重开本局；
- 结束房间。

V1.1 再考虑：

- 修改错误行动；
- 返回上一阶段。

---

## PR F — WeChat Thin Native Shell

参考 WerewolfGameJudge miniapp 的：

- WebView；
- 网络检测；
- Retry；
- onShow/onHide；
- wx.login；
- 分享。

增加本项目特有：

- Native Vibration；
- Native Realtime/Wake Channel；
- lifecycle reconnect；
- interaction wake dedup。

Web UI 继续复用现有 Web 客户端。

---

# 24. BoTC 引入时机

不要等狼人杀“所有功能都做完”。

在 PR A-D 稳定后，做一次 BotC Architecture Spike。

不是完整实现 Trouble Brewing，而是故意选择机制差异较大的少数角色，用来验证抽象：

建议：

- 小恶魔；
- 投毒者；
- 洗衣妇；
- 占卜师。

验证：

- GameModule；
- Interaction；
- Private View；
- Night Orchestrator；
- 动态信息生成；
- 多玩家秘密状态。

如果这些角色可以自然实现，则架构基本通过 BotC 检验。

---

# 25. BotC 长期结构

未来 BotC 不应把说书人推荐塞入 GameRoom。

建议：

```text
BotC Game Module
  │
  ├── Rules Engine
  ├── Character Engine
  ├── Script Loader
  ├── Night Engine
  └── Storyteller Intelligence
        ├── Knowledge Model
        ├── Information Generator
        └── Recommendation Engine
```

GameRoom 只理解：

```text
command
state
interaction
view
revision
```

而不理解：

- 酒鬼；
- 投毒者；
- 隐士；
- 红鲱鱼；
- 信息误导；
- 认知一致性推荐。

---

# 26. 对 WerewolfGameJudge 源码的具体使用清单

## 高优先级参考

```text
packages/api-worker/src/platform/room/GameRoomRuntime.ts
```

重点借鉴：

- DO 生命周期；
- acceptWebSocket；
- WebSocket tags；
- broadcast / unicast；
- snapshot；
- revision；
- command dispatch。

## 中优先级参考

```text
roomRepository.ts
actionPipeline.ts
commandSchemas.ts
requestSchemas.ts
runtimeGameModule.ts
```

重点借鉴：

- atomic update；
- validation；
- idempotency；
- game/platform boundary。

## 暂不搬入

```text
effectOutbox.ts
platformEffects.ts
userEvents/
statistics
复杂 room saga
```

## 微信小程序参考

```text
miniapp/pages/index/index.js
```

重点借鉴：

- web-view wrapper；
- 网络检测；
- Retry；
- `onShow/onHide`；
- `wx.login`；
- share flow。

在此基础上增加自己的 native vibration 和 wake channel。

---

# 27. 开源复用注意事项

WerewolfGameJudge 可作为实现参考，后续如果实际复制或改编其源码，应：

1. 再次确认目标文件的仓库许可证；
2. 按许可证要求保留版权和许可声明；
3. 将“参考架构”与“直接复制代码”区分记录；
4. 图片、音频、Logo、字体、角色素材等资产单独检查版权，不假定跟代码使用同一许可；
5. 商业化前再做一次完整第三方依赖与资产许可证审计。

原则：

> 能借成熟基础设施就借，但不要把第三方产品身份、视觉资产和不必要复杂度一起带进来。

---

# 28. Codex 实施判断规则

以后每次准备增加一个架构层或新系统时，先回答四个问题：

### 1. 这个功能是否直接改善真实朋友聚会体验？

如果没有，优先级降低。

### 2. WerewolfGameJudge 是否已经解决类似基础设施？

如果是，先审它的实现，再决定复用或简化。

### 3. 这是通用基础设施，还是我们的差异化？

通用基础设施尽量借鉴：

- Room；
- WebSocket；
- reconnect；
- revision；
- command id。

差异化自己设计：

- vibration-first；
- Dynamic Night；
- Host Recovery；
- BotC Storyteller；
- 玩家认知一致性算法。

### 4. 这个接口加入 BotC 后是否会完全失效？

不是要求现在支持完整 BotC。

只是避免把平台基础设施硬编码成狼人杀。

---

# 29. 明确的后续实施顺序

最终路线固定为：

```text
PR A
固化 GameModule
      ↓
PR B
Night Interaction / Orchestrator
      ↓
PR C
Minimal Durable Object GameRoom
      ↓
PR D
Reconnect Hardening
      ↓
PR E
Host Recovery Console
      ↓
PR F
WeChat Thin Native Shell + WebView
      ↓
BotC Architecture Spike
      ↓
完整 BotC
      ↓
Storyteller Intelligence
```

---

# 30. 当前下一步

当前最合适的下一步不是立刻改 Durable Objects。

首先执行：

> **PR A — 审计并固化现有 `GameModule` / `WerewolfGameModule`。**

紧接着：

> **PR B — 引入 `PendingInteraction` 与 Night Orchestrator。**

原因：

- 当前仓库已有 GameModule 基础；
- Night Interaction 是产品体验真正缺失的核心抽象；
- 只有把“谁现在应该行动、谁应该被唤醒”变成服务器明确状态，后面的 DO、WebSocket、微信震动和重连才能保持简单；
- 这一步对 Node 当前版本也有价值，因此不是“为了 Cloudflare 而重构”。

---

# 31. 最终原则

本项目的长期策略可以浓缩为一句话：

> **WerewolfGameJudge 帮我们解决“多人实时平台怎么做”；my-game-host-vibration 自己专注解决“怎样让面对面桌游在没有真人主持时玩得更快、更自然、更可靠”。**

V3 以后所有开发优先围绕这个原则执行。
