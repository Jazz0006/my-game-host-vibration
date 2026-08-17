# PR B3：复杂角色 Hook 架构 Spike

## 目标

B2 已经解决“普通角色如何通过 Registry 描述身份、夜间顺序和 Interaction”的问题，但复杂角色仍会碰到旧规则引擎中的硬编码边界，例如：

- 某角色阻止自己或其他玩家死亡；
- 某角色死亡后触发额外行动；
- 某角色的实际阵营会动态改变；
- 某角色改变标准胜负条件。

B3 不直接重写 `src/domain/game.ts`，而是先用最小的纯函数 Hook 合约验证这些扩展点。

## 本 PR 引入的 Hook

```ts
hooks: {
  beforeDeath?
  afterDeath?
  resolveTeam?
  evaluateVictory?
}
```

### beforeDeath

所有已分配角色都可以观察一次死亡结算，因此上下文同时区分：

- `rolePlayerId`：能力拥有者；
- `deadPlayerId`：本次准备死亡的玩家；
- `cause`：死亡来源。

这样未来可以表达保护、恋人联动等“影响其他玩家”的能力。

### afterDeath

角色可以在死亡已经成立后返回额外的逻辑动作。当前猎人的“狼刀/放逐死亡后可以开枪，被毒死不能开枪”已经可以通过该 hook 描述。

注意：B3 暂时只描述该语义，旧 `domain/game.ts` 仍然负责实际猎人流程，因此本 PR 不改变现有玩法。

### resolveTeam

允许角色在不改变存储的 role id 的前提下，根据当前状态返回动态有效阵营。

### evaluateVictory

允许角色覆盖标准胜负结果。若多个角色返回互相冲突的覆盖结果，runner 明确抛错，而不是依赖 Registry 或玩家顺序偷偷决定胜负。

## 为什么不现在修改 domain/game.ts

现有规则引擎仍包含：

- 封闭的 `Role` union；
- 封闭的 `GamePhase` union；
- 固定夜间推进；
- 女巫/守卫/猎人的专用状态字段；
- 猎人死亡触发硬编码；
- 标准胜负判断硬编码。

如果 B3 同时迁移这些内容，PR 会从“架构探针”膨胀成规则引擎重写，回归风险过大。

因此本 PR 的完成条件是证明：

1. Hook API 足以覆盖真实猎人死亡触发；
2. 可以由一个角色影响另一玩家的死亡；
3. 可以表达动态阵营；
4. 可以覆盖胜负；
5. 多个胜负 hook 冲突时有确定行为；
6. Hook runner 完全独立于 Room、Socket、Session 和客户端。

## 后续建议

B3 验证通过后，再选择一个小范围迁移 PR：

1. 优先把猎人的死亡触发从 `domain/game.ts` 迁到 HookRunner；
2. 再引入一个真实新复杂角色作为验收角色；
3. 只有真实角色证明需要时，才继续增加新的 Hook；
4. 不构建通用狼人杀 DSL。
