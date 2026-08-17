# PR B5：机械狼身份与能力来源分离架构 Spike

## 目标

B3/B4/B4.1 已分别验证：

- 单角色死亡触发（猎人）；
- 跨玩家关系与连锁死亡（丘比特）；
- 关系驱动的动态阵营与特殊胜利条件（恋人）。

B5 继续验证另一类复杂角色：**玩家的真实身份保持不变，但能力来源和查验表现可以来自另一个角色。**

机械狼非常适合验证这个边界。

本 PR 仍然是 architecture spike，不把机械狼加入生产角色表、夜间流程或客户端 UI。

## 规则基线

近期公开资料对机械狼的共同描述包括：

- 属于狼人阵营；
- 与普通狼人互不相认；
- 其他狼人仍存活时通常不参与普通狼刀；
- 一局可在任意夜晚学习一次其他玩家；
- 学习后获得该玩家对应角色的能力；
- 学习后被特定身份查验时，会表现为所学习的角色；
- 多数主动技能从下一晚开始使用；
- 学习猎人、狼人等目标时存在额外的角色特例。

不同平台对守卫、女巫、猎人、狼人复制后的资源数量、穿盾、双刀、生效时点等存在差异。因此 B5 不尝试一次实现所有机械狼规则，而是先锁定可承载这些差异的架构。

## 核心模型：四个概念必须分离

以机械狼 M 学习预言家 S 为例：

```text
assigned role      = mechanical_wolf
team               = wolf
ability source     = seer
perceived role     = seer
```

不能把 `game.roles[M]` 改成 `seer`。

否则会错误影响：

- 狼人阵营胜负；
- 狼队成员判断；
- 原角色身份显示；
- 未来其他动态规则；
- snapshot / reconnect 后的规则恢复。

## Serializable ability source state

`WerewolfRuleState` 新增：

```ts
abilitySources: WerewolfAbilitySource[]
```

单条记录：

```ts
{
  ownerPlayerId: "mechanical-wolf-player",
  sourcePlayerId: "learned-player",
  sourceRoleId: "seer",
  learnedNightNumber: 1,
  availableFromNightNumber: 2,
}
```

### 为什么同时保存 sourcePlayerId 和 sourceRoleId

`sourcePlayerId` 用于：

- 审计；
- debug；
- UI 回放；
- snapshot 可解释性。

`sourceRoleId` 是学习当时的角色快照，用于能力解析。

如果被学习玩家之后死亡、阵营变化或未来发生身份转换，机械狼已经学到的能力不应被悄悄改写。

## Ability projection

当前 `RoleDefinition.interaction` 同时包含：

- 能力语义：`kind / mode / wakePolicy / completionPolicy / isEnabled`；
- 调度语义：`phase`。

机械狼复制预言家时，应复制“查验能力”，但不应该被直接塞进 `night_seer`。

因此 B5 引入 experimental projection：

```ts
BorrowedInteractionAbility
```

它只保留：

```text
kind
mode
wakePolicy
completionPolicy
isEnabled
allowDeadActors
```

明确**不包含**：

```text
phase
nightOrder
```

这意味着未来生产实现可以：

```text
Mechanical Wolf own scheduling
        ↓
resolve borrowed ability
        ↓
execute seer / witch / guard style capability
```

而不是：

```text
Mechanical Wolf
        ↓
pretend to be Seer
        ↓
enter night_seer   ❌
```

## Learning helper

新增 experimental：

```ts
learnMechanicalWolfAbility(...)
```

当前 spike 约束：

- 一局只能学习一次；
- 不能学习自己；
- 目标必须存在；
- 默认主动能力下一晚生效；
- 生效延迟是显式参数，后续不同 ruleset 可覆盖。

## Ability profile

新增：

```ts
resolveMechanicalWolfAbilityProfile(...)
```

返回：

```ts
{
  assignedRoleId,
  effectiveTeam,
  abilitySource,
  perceivedRoleId,
  borrowedInteraction,
}
```

### 未学习时

```text
assignedRoleId = mechanical_wolf
team = wolf
perceivedRoleId = mechanical_wolf
borrowedInteraction = undefined
```

### 学习预言家后

```text
assignedRoleId = mechanical_wolf
team = wolf
perceivedRoleId = seer
borrowedInteraction.kind = seer_check
```

真实身份和阵营没有改变。

## 为什么 B5 暂不直接复制所有 lifecycle hooks

机械狼学习猎人是一个重要场景，但不能简单地把 source role 的所有 hooks 全部委托给机械狼。

原因是当前 hook 包括跨玩家规则能力：例如未来某些角色的 `afterDeath` 可能观察其他玩家死亡，而不是“该角色自己的可复制技能”。盲目复制整个 hook 会把角色规则和能力规则混为一谈。

因此 B5 先验证：

- identity / team / perceived identity 分离；
- 主动 interaction ability projection；
- serializable ability source。

后续 B5.1 应专门引入**显式 copy policy / ability capability metadata**，再处理：

- 学习猎人的死亡开枪；
- 学习女巫的一次性毒药资源；
- 学习守卫的一次性/每晚规则差异；
- 学习狼人的额外刀与继承普通狼刀；
- 哪些 hook 可以复制、哪些角色规则不能复制。

这样比直接“复制 RoleDefinition”更安全。

## 测试覆盖

新增 `tests/mechanicalWolfAbilitySourceSpike.test.ts`：

1. 学习结果可 JSON 序列化；
2. 学习不会改变 `game.roles`；
3. 同一机械狼不能学习第二次；
4. 真实阵营保持 wolf；
5. `perceivedRoleId` 可以变成学习目标角色；
6. 默认学习当晚主动技能不可用；
7. 下一晚复制能力可用；
8. 借用能力不包含 source role 的 `phase` / `nightOrder`；
9. 学习平民只改变查验表现、不产生主动技能；
10. 被学习玩家死亡后能力来源仍保留；
11. 禁止学习自己和不存在的玩家。

## 非目标

本 PR 不实现：

- 生产机械狼角色注册；
- `night_mechanical_wolf`；
- 与普通狼人互不相认的生产视图；
- 其他狼人死光后的狼刀继承；
- 学习狼人后的双刀；
- 猎人死亡 hook 复制；
- 女巫/守卫复制后的资源细则；
- 通灵师正式生产角色与查验流程；
- 客户端 UI。

## 后续

如果 B5 通过，建议 B5.1 继续做 **Copy Policy / Capability metadata**，用“机械狼学习猎人 + 女巫”同时验证：

- 被动 trigger 能力复制；
- 一次性资源能力复制；
- 不能复制整个 role hook bundle；
- ability capability 是否足以服务未来其他复制/偷取/继承角色。
