# PR B4 — 丘比特关系与连锁死亡 Architecture Spike

## 目标

B3/B3.1/B3.2 已经证明猎人的“死亡后触发一次玩家行动”可以从 domain 硬编码迁移到 Role Registry + HookRunner。

B4 用丘比特验证明显不同的复杂机制：

1. 首夜建立一次性的跨玩家关系；
2. 关系需要持久化并可序列化；
3. 任一恋人死亡会产生另一名恋人的连锁死亡；
4. 连锁死亡不能重复结算或形成 A → B → A 无限循环；
5. 规则层要能区分“触发玩家交互”和“触发规则效果”。

## 规则基线

本 Spike 采用经典丘比特的基础规则：第一夜选择两名不同玩家成为恋人；丘比特可以选择自己；任一恋人死亡时另一名恋人立即死亡。

人狼恋带来的特殊阵营/胜利目标不在 B4 范围，留给 B4.1。

## 关键设计

### 1. Sidecar WerewolfRuleState

新增 `WerewolfRuleState`，当前只保存 relationships。

它属于 `games/werewolf`，不加入 `domain.GameState`。这样可以先验证狼人杀复杂规则状态的形状，而不继续扩大 legacy domain 对具体游戏的所有权。

该状态是普通 JSON 数据，可以未来随房间快照一起持久化到 Durable Object。

### 2. TriggeredAction → RuleEffect

B3 的 `afterDeath` 只能返回类似 Hunter `hunter_shot` 的行动。

B4 将结果升级为两种 effect：

- `interaction`：例如 Hunter 开枪；
- `death`：例如恋人殉情。

这避免把“系统规则变化”伪装成玩家交互。

### 3. 纯递归 Death Chain Resolver

`resolveWerewolfDeathChain()`：

- 输入初始死亡；
- 依次执行 afterDeath hooks；
- 将 death effects 加入队列；
- 已解析/已死亡玩家不会再次入队；
- 返回完整死亡序列和非死亡 interaction effects；
- 不直接修改生产 `GameState`。

因此 A 恋人死亡时：

```text
A: night_attack
  ↓ Cupid afterDeath
B: ability
  ↓ Cupid afterDeath
A already resolved → ignored
```

### 4. Experimental Cupid

`experimental/CupidRoleDefinition.ts` 不加入生产 Registry、脚本或配置牌池。

原因是当前 `Role` / `GamePhase` 仍是封闭 union。B4 的任务是先验证关系和 effect 模型，不把“开放角色 ID”“新增首夜正式 phase/command/UI”同时塞进一个 PR。

## B4 明确不做

- 不把 Cupid 加入可选角色；
- 不修改默认/预设牌组；
- 不增加 `night_cupid` 正式 phase；
- 不接 UI/Socket/Room；
- 不把 death effect 接入正式 domain settlement；
- 不实现恋人互认 UI；
- 不实现恋人禁止互投；
- 不实现人狼恋第三阵营或特殊胜利；
- 不实现机械狼。

## 验收

B4 测试应证明：

- relationship state 可 JSON round-trip；
- Cupid 可选择自己作为恋人之一；
- 两个恋人必须不同；
- 任一恋人死亡产生另一人的 `ability` death；
- 连锁不会无限循环；
- 已死亡目标不会重复死亡；
- Hunter 仍使用 interaction effect，原生产路径行为不变；
- domain 不新增 games 依赖。

## 后续建议

如果 B4 通过：

### B4.1
验证恋人的 alignment / victory 规则，包括人狼恋的特殊胜利目标。

### B4.2（可选）
将 relationship state 纳入正式房间快照，并把 death-chain resolver 接入生产死亡结算。

### B5
使用机械狼验证“身份与当前能力分离 / 动态能力集合 / 动态夜间行动”模型。
