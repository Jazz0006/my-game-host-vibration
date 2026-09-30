# Documentation Index

## Current authority

Use these in this order:

1. `AGENTS.md` — repository-wide engineering, ownership, merge and product rules.
2. `开发计划_V5_客户端运行时与网络韧性实施路线.md` — current milestone, implementation order and validation checkpoints.
3. `长期架构与DurableObjects迁移设计_V4.md` — current long-term architecture baseline.
4. `docs/微信客户端大厅与方桌_UI实施基线_2026-09-28.md` — current WeChat lobby/table UX baseline.
5. live code / Git / tests / runtime evidence.

## Current handoff

- `docs/B0C_TROUBLE_BREWING_INFORMATION_RECOMMENDATION_HANDOFF_2026-09-30.md`
  - current B0C Rules/Information -> Storyteller Recommendation decomposition;
  - B0C1 Demon Info legality/recommendation-boundary merged through PR #109;
  - B0C2 baseline recommendation + Game Engine commit/private delivery GREEN checkpoint;
  - B0C3 setup-information registration + Washerwoman entry scope.
- `docs/B0B_TROUBLE_BREWING_NIGHT_SEQUENCING_HANDOFF_2026-09-30.md`
  - completed B0B sequencing authority and B0C handoff.
- `docs/B0B3_BOTC_OWNERSHIP_BOUNDARY_AUDIT_2026-09-30.md`
  - Setup Generation / Canonical Truth / Game Engine / Rules-Information / Recommendation ownership contract;
  - B0A/B0B boundary findings and implementation guardrails.

## Current product route

```text
MG0 COMPLETE
  ↓
B0 BotC / Trouble Brewing production entry
  ├─ B0A module + setup/view contracts ✅ COMPLETE
  ├─ B0B first-night / night sequencing ✅ COMPLETE
  │   ├─ B0B1 canonical order + first-night progression ✅ MERGED
  │   ├─ B0B2 later-night dynamic eligibility / progression ✅ COMPLETE
  │   │   ├─ B0B2A recurring / conditional eligibility ✅ MERGED
  │   │   └─ B0B2B immediate trigger / role-transition sequencing ✅ MERGED PR #107
  │   └─ B0B3 ownership hardening + live runtime progression ✅ COMPLETE
  └─ B0C Rules / Information → Storyteller Recommendation ← CURRENT
      ├─ B0C1 Demon Info legal candidates + recommendation boundary ✅ MERGED PR #109
      ├─ B0C2 recommendation policy + authoritative commit/private delivery ✅ LOCAL GREEN
      └─ B0C3 setup-information registration + Washerwoman ← NEXT AFTER MERGE
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
