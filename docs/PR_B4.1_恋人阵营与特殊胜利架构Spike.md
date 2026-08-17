# PR B4.1：恋人阵营与特殊胜利架构 Spike

## 目标

B4 已验证：

- 丘比特首夜可以创建可序列化的恋人关系；
- 一名恋人死亡可以通过 rule effect 触发另一名恋人连锁死亡；
- 连锁死亡不会造成 A -> B -> A 无限循环。

B4.1 继续验证关系规则的第二类能力：**关系可以改变有效阵营与胜利条件，而不改变玩家原始身份。**

同时，本项目面向不同狼人杀规则集，丘比特不能硬编码成单一平台规则。因此 B4.1 支持两种可配置规则变体。

本 PR 仍然是 architecture spike，不把丘比特加入生产角色表、夜间阶段或客户端 UI。

## 丘比特规则变体

```ts
export type CupidRuleVariant =
  | "classic_millers_hollow"
  | "china_three_party";
```

### classic_millers_hollow

经典《米勒山谷狼人》基线：

- 同阵营恋人保持原阵营；
- 人狼恋时，两名恋人成为特殊 `lovers` 阵营；
- 如果丘比特选择的是另外两名玩家，丘比特仍留在自己的原阵营；
- 两名混合恋人必须成为最后两名存活玩家才能获得 Lovers 胜利。

### china_three_party

国内平台常见的人狼恋第三方变体：

- 人人恋：不产生第三方，保持原阵营；
- 狼狼恋：不产生第三方，保持原阵营；
- 人狼恋：丘比特 + 两名恋人共同属于特殊 `lovers` 阵营；
- 丘比特即使没有选择自己，也通过 relationship 的 `sourceRolePlayerId` 加入第三方；
- 当所有仍存活的玩家都属于该第三方成员集合，Lovers 获胜；
- 丘比特可以已经死亡，只要两名恋人仍完整存活并消灭其他阵营，第三方仍可获胜。

## 为什么不把丘比特塞进 playerIds

关系结构仍保持：

```ts
{
  kind: "lovers",
  sourceRolePlayerId: "cupid-player",
  playerIds: ["lover-a", "lover-b"]
}
```

其中：

- `playerIds` 永远表示真正的两名恋人；
- `sourceRolePlayerId` 表示建立关系的丘比特；
- 是否把丘比特视为第三方成员，由 `CupidRuleVariant` 解释。

这样不会污染“恋人只有两人”的关系语义，也便于以后增加其他平台规则。

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

文件：

```text
src/games/werewolf/roles/experimental/LoversRuleResolver.ts
```

提供：

```ts
resolveLoversEffectiveTeam(...)
resolveLoversVictory(...)
```

两个函数都接受 `CupidRuleVariant`。

### Effective team

以人狼恋为例：

```text
classic_millers_hollow
Cupid A -> 原阵营
Wolf B  -> lovers
Human C -> lovers

china_three_party
Cupid A -> lovers
Wolf B  -> lovers
Human C -> lovers
```

角色身份本身不变：狼人仍是狼人角色，丘比特仍是丘比特角色。

### 与动态阵营组合

Lovers resolver 支持调用方传入 `LoversBaseTeamResolver`。

这样未来可以先通过 B3 `resolveTeam` 得到角色当前有效阵营，再由 Lovers 关系规则做二次解释，避免机械狼、变阵营角色等被静态 `role.team` 错判。

## Victory override

只要混合恋人的两名 Lover 都还活着，普通 faction victory 就被暂停，避免 legacy：

```ts
if (wolves >= others) return "wolf";
```

过早判狼人胜利。

### Classic

```text
混合情侣仍活着
      ↓
只剩两名 Lover？
  是 -> lovers
  否 -> null，继续游戏
```

### China three-party

第三方成员集合为：

```text
Cupid + Lover A + Lover B
```

```text
混合情侣仍活着
      ↓
所有存活玩家是否都属于第三方成员集合？
  是 -> lovers
  否 -> null，继续游戏
```

因此既支持三人终局：

```text
Cupid + Wolf Lover + Human Lover
```

也支持丘比特先死后的两人终局：

```text
Wolf Lover + Human Lover
```

如果任一 Lover 已死，则特殊胜利不再阻塞普通阵营胜负；B4 的连锁死亡会在生产接入后处理另一名 Lover 的随死。

## 关系状态约束

保持：

- 恋人必须是两名不同玩家；
- relationship id 不可重复；
- 一名玩家不能同时属于多组 Lovers relationship。

`sourceRolePlayerId` 不算第二组恋人关系成员，因此丘比特可以正常创建一组自己并未参与的恋人关系。

## 测试覆盖

`tests/loversAlignmentVictorySpike.test.ts` 覆盖：

1. Classic 人狼恋：两名恋人进入 `lovers`，丘比特仍保持原阵营；
2. China 人狼恋：丘比特 + 两名恋人三人全部进入 `lovers`；
3. China 人人恋：不产生第三方；
4. China 狼狼恋：不产生第三方；
5. 原始角色身份不改变；
6. 动态基础阵营 resolver 可以覆盖静态 role team；
7. 混合情侣存活时压制 legacy 狼人平票胜利；
8. Classic 最后两名恋人时 Lovers 获胜；
9. China 丘比特 + 两名恋人三人终局时 Lovers 获胜；
10. China 丘比特死亡、两名恋人最后存活时仍判 Lovers 获胜；
11. 混合情侣被打破后恢复普通 faction victory；
12. 禁止重叠恋人关系。

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

B4.1 验证通过后，下一步建议进入 B5：机械狼，用来验证：

- 原始身份与当前能力来源分离；
- 动态获得 / 模仿技能；
- registry 是否足以表达 ability delegation；
- 是否需要独立 ability source / copied role state。
