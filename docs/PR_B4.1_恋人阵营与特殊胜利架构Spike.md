# PR B4.1：恋人阵营与特殊胜利架构 Spike

## 目标

B4 已验证：

- 丘比特首夜可以创建可序列化的恋人关系；
- 一名恋人死亡可以通过 rule effect 触发另一名恋人连锁死亡；
- 连锁死亡不会造成 A -> B -> A 无限循环。

B4.1 继续验证关系规则的第二类能力：**关系可以改变有效阵营与胜利条件，而不改变玩家原始身份。**

本 PR 仍然是 architecture spike，不把丘比特加入生产角色表、夜间阶段或客户端 UI。

## 规则基线

采用经典《米勒山谷狼人 / Les Loups-Garous de Thiercelieux》丘比特规则：

1. 同阵营恋人仍然跟随原阵营目标。
2. 如果一名狼人和一名村民成为恋人，他们必须共同消灭所有其他玩家，最后两人存活才能获胜。
3. 混合情侣存在时，普通狼人阵营不能仅因为人数达到平票条件而提前获胜。
4. 玩家原始身份不改变：狼人恋人仍然是狼人角色，村民恋人仍然是原村民角色；改变的是用于胜负判断的 effective team / objective。

## 类型扩展

`WerewolfTeam`：

```ts
"village" | "wolf" | "neutral" | "lovers"
```

`WerewolfWinner`：

```ts
"wolf" | "village" | "lovers"
```

这里的 `lovers` 表示特殊胜利阵营，而不是把角色身份改写成新角色。

## Experimental LoversRuleResolver

新增：

```text
src/games/werewolf/roles/experimental/LoversRuleResolver.ts
```

提供两个纯函数：

```ts
resolveLoversEffectiveTeam(...)
resolveLoversVictory(...)
```

### Effective team

- 无恋人关系：返回角色原阵营。
- 村民 + 村民：双方仍为 `village`。
- 狼人 + 狼人：双方仍为 `wolf`。
- 狼人 + 村民：双方 effective team 为 `lovers`。

原始 `game.roles[playerId]` 不发生改变。

### Victory override

对于仍然存活的狼人 + 村民混合情侣：

```text
普通 checkVictory()
        ↓
如果混合情侣仍完整存活
        ↓
还有其他存活玩家？ ── 是 ──> null（阻止普通阵营提前胜利）
        │
        否
        ↓
仅剩两名恋人
        ↓
"lovers"
```

如果混合情侣已经被打破，则恢复普通 faction victory。

## 为什么必须覆盖普通狼人平票胜利

当前 legacy domain 的 `checkVictory()` 使用：

```ts
if (wolves === 0) return "village";
if (wolves >= others) return "wolf";
```

因此例如：

```text
狼人恋人 A
村民恋人 B
普通狼人 C
普通村民 D（已死亡）
```

当前存活：A / B / C。

legacy 计算：

```text
wolves = 2
others = 1
=> wolf victory
```

但经典丘比特规则下，A 已经与 B 形成混合情侣，不能跟 C 一起直接获得狼人胜利。

B4.1 resolver 因此返回 `null`，让游戏继续；当最终只剩 A + B 时返回 `lovers`。

## 关系状态约束补强

B4 已禁止：

- 恋人选择同一个玩家两次；
- 重复 relationship id。

B4.1 再增加：

- 一名玩家不能同时属于两组 Lovers relationship。

这使 `loverOf(playerId)` 保持单值语义，也避免未来 snapshot 恢复时产生模糊关系图。

## 测试

新增 `tests/loversAlignmentVictorySpike.test.ts`，覆盖：

1. 狼人 + 村民情侣 effective team = `lovers`；
2. 原始角色身份不改变；
3. 同阵营恋人保持原阵营；
4. 混合情侣存活时阻止 legacy 狼人平票胜利；
5. 最后只剩混合情侣时返回 `lovers` 胜利；
6. 一名恋人死亡后恢复普通 faction victory；
7. 禁止重叠恋人关系。

## 非目标

本 PR 不实现：

- 丘比特生产角色注册；
- `night_cupid`；
- Lovers 相认 UI；
- 生产 `GameState.winner` 扩展；
- 将 Lovers resolver 接入 legacy `checkVictory()`；
- 生产连锁死亡 settlement；
- 机械狼。

这些内容在 architecture spike 通过后再分阶段接入。

## 后续

如果 B4.1 测试通过，下一步建议进入 B5：机械狼，用来验证：

- 原始身份与当前能力来源分离；
- 动态获得 / 模仿技能；
- registry 是否足以表达 ability delegation；
- 是否需要独立 ability source / copied role state。
