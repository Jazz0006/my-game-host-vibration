# PR B5.1：机械狼 Copy Policy 与能力资源架构 Spike

## 目标

B5 已验证：

- 机械狼真实身份不需要改写；
- 阵营、能力来源、查验表现可以彼此分离；
- 学习结果可以作为可序列化 `abilitySources` 保存；
- 主动 interaction 可以投影复制，但不能复制 source role 的 `phase / nightOrder`。

B5.1 继续解决更困难的问题：**哪些角色能力允许被复制，以及复制后资源和触发条件如何表达。**

本 PR 仍是 architecture spike，不把机械狼接入生产夜间流程。

## 为什么不能复制整个 RoleDefinition / hooks

机械狼学习不同角色时，继承语义并不一致。

例如：

- 学习猎人：获得“自己死亡时开枪”的能力；
- 学习女巫：获得的是一瓶属于机械狼自己的毒药，而不是共享真女巫药瓶；
- 学习预言家/通灵师：获得可重复主动查验能力；
- 学习村民：没有主动技能。

因此不能简单做：

```text
Mechanical Wolf
    ↓
copy source RoleDefinition
    ↓
copy all hooks / resources / phase   ❌
```

否则容易出现：

- 复制跨玩家 hook；
- 与真女巫共享 `witchPoisonSpent`；
- 错误继承原角色调度阶段；
- 把角色规则误当作可复制能力。

## Explicit Copy Policy

新增 experimental：

```text
src/games/werewolf/roles/experimental/MechanicalWolfCopyPolicy.ts
```

核心类型：

```ts
MechanicalWolfCopyPolicy
MechanicalWolfCopyCapability
```

当前 capability 只验证两类：

```text
interaction
self_death_interaction
```

### Hunter

```text
sourceRoleId = hunter
capability = self_death_interaction
interactionKind = hunter_shot
allowedCauses = night_attack | day_elimination
```

这意味着：

- 机械狼本人死亡才触发；
- 狼刀死亡可以开枪；
- 白天放逐可以开枪；
- 毒死不能开枪；
- 不调用 Hunter 原始 `afterDeath` hook bundle。

Hunter 属于死亡触发特例，不受普通主动技能“下一晚生效”的约束。

### Witch

复制女巫不直接复制：

```text
witch_action
```

因为原女巫 interaction 同时包含解药/毒药等生产语义。

B5.1 显式转换为：

```text
mechanical_wolf_poison
```

并绑定：

```ts
{
  key: "copied_witch_poison",
  initialUses: 1,
}
```

因此机械狼的毒药是独立 capability，不与真女巫资源共享。

## Serializable ability resources

`WerewolfRuleState` 新增：

```ts
abilityResources: WerewolfAbilityResource[]
```

单条资源：

```ts
{
  ownerPlayerId: "mech",
  key: "copied_witch_poison",
  remainingUses: 1,
}
```

它满足：

- 可 JSON 序列化；
- 可 snapshot / reconnect；
- 可 Durable Object 持久化；
- 资源属于 ability owner，不属于 source role/player；
- 不污染 legacy `GameState` 的女巫字段。

## 资源 API

`WerewolfRuleState` 增加：

```ts
addAbilityResource(...)
abilityResourceFor(...)
spendAbilityResource(...)
```

B5.1 policy resolver 增加：

```ts
initializeMechanicalWolfCopiedResources(...)
availableMechanicalWolfCopiedInteractions(...)
consumeMechanicalWolfCopiedInteraction(...)
resolveMechanicalWolfCopiedSelfDeathEffects(...)
```

`consumeMechanicalWolfCopiedInteraction` 自己再次校验：

- 已到 activation night；
- capability 当前存在；
- resource 尚未耗尽。

不能只依赖调用方先查询 available。

## 为什么资源不放进 GameState

当前 `GameState` 里已有：

```text
witchAntidoteSpent
witchPoisonSpent
```

这些是 legacy 真女巫生产字段。

如果机械狼复制女巫也复用这些字段，会导致：

- 真女巫用了毒 → 机械狼错误失去毒；
- 机械狼用了毒 → 真女巫错误失去毒；
- 多种未来复制/偷取角色无法扩展。

所以 copied ability resource 必须放在规则 sidecar state。

## 测试覆盖

新增：

```text
tests/mechanicalWolfCopyPolicySpike.test.ts
```

覆盖：

1. 学习猎人后，机械狼本人被狼刀可触发 `hunter_shot`；
2. 白天放逐可触发，毒死不可触发；
3. 其他玩家死亡不会误触发机械狼猎枪；
4. 学习女巫后创建独立一瓶 copied poison；
5. 真女巫 `witchPoisonSpent=true` 不影响机械狼自己的毒；
6. copied poison 可序列化；
7. 学习当晚 copied poison 不可用；
8. 下一晚可用；
9. 使用一次后 resource 变 0；
10. 第二次使用被拒绝；
11. 不能绕过 activation night 直接 consume；
12. 学习村民不产生 capability/resource。

## 非目标

本 PR 不实现：

- 生产机械狼注册；
- `night_mechanical_wolf`；
- 机械狼与普通狼人互不相认视图；
- 普通狼人死光后的狼刀继承；
- 学习狼人的双刀；
- 守卫成功挡刀后技能失效等平台特例；
- 真正执行 `mechanical_wolf_poison` 的 domain mutation；
- 客户端交互。

## 后续

如果 B5.1 验证通过，建议下一步不再继续扩大 experimental role spike，而是回到主迁移路线：

1. 把目前已经验证的 role / interaction / hook / relationship / ability-source 模型整理成稳定边界；
2. 开始 Reconnect / Cloud Room / Durable Objects 方向的下一阶段；
3. 复杂角色的剩余特例按真实生产需求逐个接入，而不是预先构建大型规则 DSL。
