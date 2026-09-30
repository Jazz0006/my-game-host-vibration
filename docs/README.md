# Documentation Index

## Current authority

Use these in this order:

1. `AGENTS.md` — repository-wide engineering, ownership, merge and product rules.
2. `开发计划_V5_客户端运行时与网络韧性实施路线.md` — current milestone, implementation order and validation checkpoints.
3. `长期架构与DurableObjects迁移设计_V4.md` — current long-term architecture baseline.
4. `docs/微信客户端大厅与方桌_UI实施基线_2026-09-28.md` — current WeChat lobby/table UX baseline.
5. live code / Git / tests / runtime evidence.

## Development workflow baseline

- Normal development is **Mini MCP local-first**; local inspection/edit/Git/validation and GitHub PR/CI/review/merge control-plane operations go through Mini MCP direct tools.
- ChatGPT owns semantics, architecture, scope and acceptance judgment; Codex/Luna is a bounded local implementation worker (`edit -> test -> repair`) and does not independently choose architecture or GitHub control-plane actions.
- Related micro-slices may remain local until a **logical checkpoint**. At that point run Mini MCP `quality` (`check-file-sizes + typecheck + test`), review the exact diff, commit, then push once for independent GitHub acceptance.
- GitHub remains canonical remote truth and independent CI acceptance, but it is not the normal per-edit test loop. Detailed normative rules live in `AGENTS.md`.

## Current handoff

- `docs/SIMULATOR_FIRST_BOTC_PLAYABLE_VERTICAL_SLICE_ROUTE_2026-09-30.md`
  - **current detailed implementation route**;
  - Simulator Lab V2 first, then BotC playable vertical integration;
  - normal development defaults to zero real devices;
  - B0C3B/deeper recommendation quality is deferred until the playable path needs it.
- `docs/B0C_TROUBLE_BREWING_INFORMATION_RECOMMENDATION_HANDOFF_2026-09-30.md`
  - B0C1/B0C2/B0C3A completed foundation and recommendation-boundary history;
  - B0C3A registration + truthful Washerwoman candidate boundary is retained;
  - direct continuation into B0C3B is superseded as NEXT by the Simulator-first playable route.
- `docs/B0B_TROUBLE_BREWING_NIGHT_SEQUENCING_HANDOFF_2026-09-30.md`
  - completed B0B sequencing authority and B0C handoff.
- `docs/B0B3_BOTC_OWNERSHIP_BOUNDARY_AUDIT_2026-09-30.md`
  - Setup Generation / Canonical Truth / Game Engine / Rules-Information / Recommendation ownership contract;
  - B0A/B0B boundary findings and implementation guardrails.

## Current product route

```text
MG0 COMPLETE
  ↓
B0A–B0B3 BotC module / setup contract / night sequencing ✅
  ↓
B0C1 / B0C2 / B0C3A rules-information foundations ✅ checkpointed
  ↓
SIM-0 Simulator Lab V2 foundation ✅
  ↓
PV-0 shared Lobby production interactions ← CURRENT / NEXT
  ↓
PV-1 minimal BotC Setup + production start path
  ↓
PV-2 role reveal / confirm-role
  ↓
PV-3 first-night playable UI
  ↓
PV-4 minimal day/night loop
  ↓
PV-5 simulator full-game acceptance
  ↓
PV-6 WeChat Developer Tools parity
  ↓
PV-7 staged real-device acceptance
```

B0C3B and later storyteller recommendation depth remain valuable but are **deferred as mainline**. A playable step may use the simplest rules-legal baseline when recommendation quality is not yet mature.

## Parallel engineering route

- `docs/多人自动化与真机测试战略_2026-09-30.md`
  - platform-level multiplayer test strategy and direct support for the Simulator-first playable mainline;
  - virtual `TestRoomClient` / multi-client convergence / reconnect / idempotency / privacy plan;
  - T0/T1/T2/T3 complete: seam audit, shared TestRoomClient, 10-client convergence, reconnect and deterministic fault injection;
  - SIM-0 complete: shared dev/test harness now powers `/dev/lab` with phone viewer, N virtual clients, Storyteller/debug inspector and deterministic disconnect/reconnect;
  - T4 privacy/projection work follows stable PV contracts, with secret-differentiated BotC coverage deferred until PV-2;
  - T5 device tooling is an escalation toolkit, **not** a daily two-device requirement;
  - default daily development uses zero real devices.
- `docs/T0_MULTIPLAYER_HARNESS_SEAM_AUDIT_2026-09-30.md`
  - T0 owner/seam audit and existing-test map;
  - production-gap result: NONE for T1;
  - T1 historical implementation contract: capability adapter + production bootstrap/Raw WS/ClientSession owners; SIM-0 later moved the shared client/harness implementation to `dev/` for one dev+test owner.

## Historical / superseded documents

These are retained for decision history only and must not override current authority:

- `开发计划_V4_架构验证后实施路线.md` — superseded by V5.
- `长期架构与DurableObjects迁移设计_V3.md` — superseded by V4.
- `D2.1_Cloudflare_Runtime_Skeleton.md` — historical early Cloudflare checkpoint.

Do not derive a current NEXT/CURRENT milestone from historical documents.
