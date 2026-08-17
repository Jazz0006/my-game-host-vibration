# PR B4b — Dynamic Cupid Orchestration Spike

## 目标

B4a 已验证丘比特关系状态与连锁死亡模型。B4b 不继续扩展通用规则 DSL，而是回到 `长期架构与DurableObjects迁移设计_V3.md` 的核心目标：

> 验证新增动态剧本与动态角色时，夜间主持流程不需要继续扩展写死的 `GamePhase` / `NIGHT_ORDER`。

丘比特被选作压力测试角色，因为它只在第一夜行动，后续夜晚自动消失，能够验证动态编排是否真正由 Script + RoleDefinition 驱动。

## 范围

B4b 只建立旁路 architecture spike，不替换现有生产状态机。

实现内容：

- `WerewolfScriptDefinition` 支持泛型 role id；
- legacy `configFromScript()` 仍只接受现有 `Role`；
- Role interaction 增加可选动态夜间 metadata：`order + schedule`；
- Cupid 定义首夜 interaction，但不绑定 legacy phase；
- 新增纯 `WerewolfDynamicNightPlanner`；
- 新增 experimental Cupid script；
- 新增动态编排架构测试。

## 明确不做

- 不新增 `night_cupid`；
- 不修改 `src/domain/game.ts` 的固定夜间状态机；
- 不修改 `WerewolfGameModule` command/view switch；
- 不把 Cupid 加入生产 Registry 或正式脚本目录；
- 不接 Web / Socket / Room；
- 不实现人狼恋阵营与胜利规则；
- 不删除 legacy phase。

## 动态编排模型

```text
Script / actual assignments
        ↓
RoleDefinition.interaction.night
        ↓
Dynamic Night Planner
        ↓
PendingInteraction[]
```

Planner 只读取：

- 当前 nightNumber；
- 实际角色分配；
- 玩家存活状态；
- interaction eligibility；
- role night order / schedule。

Planner 不读取：

- `GamePhase`；
- `NIGHT_ORDER`；
- lifecycle hooks；
- UI / Socket / Room。

## 丘比特行为

Cupid metadata：

```text
order = 5
schedule = first_night_only
kind = cupid_link_lovers
```

因此带丘比特的测试剧本应自动得到：

```text
Night 1
Cupid -> Guard -> Werewolf -> Witch -> Seer

Night 2+
Guard -> Werewolf -> Witch -> Seer
```

无需存在 `night_cupid`。

## Definition of Done

1. Script 可包含未进入 legacy `Role` union 的 Cupid；
2. 第一夜自动产生 `cupid_link_lovers`；
3. 第二夜以后自动不产生 Cupid interaction；
4. 本局没有 Cupid 时，即使 Registry 存在 Cupid 也不会运行；
5. 死亡角色自动不进入行动队列；
6. 现有 `isEnabled` 条件（例如女巫资源耗尽）仍有效；
7. 修改 RoleDefinition 的 order 会改变编排顺序，证明没有 hidden fixed order；
8. `domain/game.ts` 与 `WerewolfGameModule.ts` 不新增 `night_cupid`。

## 后续

如果 B4b 通过，不立即全面重写 GameModule。下一步应选择一个现有生产夜间 interaction 做 strangler migration，使其由 dynamic orchestrator 驱动，同时保留 legacy phase 兼容层，再逐步减少固定夜间流程的所有权。
