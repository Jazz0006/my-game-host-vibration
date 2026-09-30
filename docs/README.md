# Documentation Index

## Current authority

Use these in this order:

1. `AGENTS.md` — repository-wide engineering, ownership, merge and product rules.
2. `开发计划_V5_客户端运行时与网络韧性实施路线.md` — current milestone, implementation order and validation checkpoints.
3. `长期架构与DurableObjects迁移设计_V4.md` — current long-term architecture baseline.
4. `docs/微信客户端大厅与方桌_UI实施基线_2026-09-28.md` — current WeChat lobby/table UX baseline.
5. live code / Git / tests / runtime evidence.

## Current handoff

- `docs/B0B_TROUBLE_BREWING_NIGHT_SEQUENCING_HANDOFF_2026-09-30.md`
  - current B0B decomposition and sequencing authority;
  - B0B1/B0B2A merged checkpoints and B0B2B local GREEN evidence;
  - B0B3 live runtime progression / command-integration entry scope.

## Current product route

```text
MG0 COMPLETE
  ↓
B0 BotC / Trouble Brewing production entry
  ├─ B0A module + setup/view contracts ✅ COMPLETE
  ├─ B0B first-night / night sequencing ← CURRENT
  │   ├─ B0B1 canonical order + first-night progression ✅ MERGED
  │   ├─ B0B2 later-night dynamic eligibility / progression ← CURRENT
  │   │   ├─ B0B2A recurring / conditional eligibility ✅ MERGED
  │   │   └─ B0B2B immediate trigger / role-transition sequencing ✅ LOCAL GREEN
  │   └─ B0B3 live runtime progression / command integration ← NEXT AFTER MERGE
  └─ B0C+ information / storyteller intelligence
```

## Parallel engineering route

- `docs/多人自动化与真机测试战略_2026-09-30.md`
  - platform-level multiplayer test strategy;
  - virtual `TestRoomClient` / multi-client convergence / reconnect / idempotency / privacy plan;
  - two-real-device + N-virtual-player smoke route and milestone full-table acceptance;
  - T0/T1/T2/T3 complete: seam audit, shared TestRoomClient, 10-client convergence, reconnect and deterministic fault injection;
  - parallel NEXT: T4 privacy / projection matrix;
  - this route is parallel to B0B and does **not** replace the V5 mainline NEXT.
- `docs/T0_MULTIPLAYER_HARNESS_SEAM_AUDIT_2026-09-30.md`
  - T0 owner/seam audit and existing-test map;
  - production-gap result: NONE for T1;
  - T1 implementation contract: test-only Cloudflare/DO capability adapter + production bootstrap/Raw WS/ClientSession owners.

## Historical / superseded documents

These are retained for decision history only and must not override current authority:

- `开发计划_V4_架构验证后实施路线.md` — superseded by V5.
- `长期架构与DurableObjects迁移设计_V3.md` — superseded by V4.
- `D2.1_Cloudflare_Runtime_Skeleton.md` — historical early Cloudflare checkpoint.

Do not derive a current NEXT/CURRENT milestone from historical documents.
