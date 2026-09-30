# UGSM-0 — Unified Trouble Brewing Game Snapshot Adoption Audit (2026-09-30)

> Project: `Jazz0006/my-game-host-vibration`  
> Status: **ARCHITECTURE CHECKPOINT — ADOPTED BEFORE PV-3B2**  
> Scope: Trouble Brewing only.  
> Purpose: align this online runtime with the cross-project canonical Trouble Brewing snapshot model without merging project runtimes or replacing this repository's authoritative mutable game state.

---

## 1. Decision

The project will adopt the same canonical **Trouble Brewing game snapshot semantics** used across the current Game Engine / Storyteller Recommendation / EvidenceLab work.

The cross-project contract is:

```text
TroubleBrewingGameSnapshotV1
= immutable / read-only / deterministic canonical projection
= a description of game truth and explicitly unresolved facts at one decision point
= not a mutable runtime owner
```

This repository therefore must not create a second independent "recommendation game state", "evidence game state", or "simulator game state".

The integration direction is:

```text
authoritative online BotcGameState
        |
        | pure projection
        v
TroubleBrewingGameSnapshotV1
        |
        +--> Rules / Information decision context
        +--> Storyteller Recommendation request context
        +--> deterministic replay / fixtures
        +--> cross-project semantic-equivalence tests
```

The existing `BotcGameState` remains the authoritative mutable online game state owned by `BotcGameModule`.

---

## 2. Why this checkpoint is required now

PV-3A/PV-3B1 already established:

- canonical night progression;
- actual-vs-shown setup assignments;
- authoritative death/transition facts;
- Poisoner and Butler committed effects;
- Demon Info committed state;
- private/public/moderator projections.

PV-3B2 is the first slice that will add a broader family of **committed information results** and must distinguish:

- facts that are already committed;
- facts whose legal domain exists but whose concrete value has not yet been chosen;
- facts that are unavailable/unknown in historical evidence;
- facts that do not apply at the current decision point.

If PV-3B2 adds these semantics directly as ad-hoc runtime-only shapes with no canonical snapshot mapping, this repository will begin drifting from the Game Engine / Recommendation / EvidenceLab model at exactly the point where cross-project reuse matters most.

Therefore UGSM-0 is an architecture gate before PV-3B2 expands state.

---

## 3. Cross-project canonical semantics

The shared V1 model uses explicit fact state rather than ambiguous null/undefined values:

```text
KNOWN(value)
UNCOMMITTED
UNKNOWN
NOT_APPLICABLE
```

Required meaning:

- **KNOWN(value)** — the canonical value is committed/known at this snapshot.
- **UNCOMMITTED** — the game rules define this fact/decision, but no authoritative value has yet been committed.
- **UNKNOWN** — the value may exist, but the producer cannot reconstruct or know it.
- **NOT_APPLICABLE** — the fact does not apply in this game/decision context.

Important consequence:

> `undefined` in a TypeScript runtime object is not, by itself, a cross-project semantic state.

The canonical snapshot must serialize unresolved facts deterministically and preserve their meaning.

---

## 4. Current repository owner audit

### 4.1 Mutable authoritative owner — keep

Current owner:

`src/games/botc/BotcGameModule.ts :: BotcGameState`

It currently owns online mutable facts including:

- `scriptId`;
- `phase`;
- canonical setup `assignments`;
- role-confirmation progress;
- day/night counters;
- deaths and execution-related facts;
- role transitions;
- committed Demon Info;
- Poisoner target;
- Butler master;
- current night cursor/progression.

This remains the production mutation owner.

Do **not** replace it with the snapshot DTO and do not move command-processing behavior into the snapshot layer.

### 4.2 Setup owner — keep

`TroubleBrewingSetup.ts` remains the setup legality/canonicalization owner.

The snapshot may represent setup facts, including unresolved facts, but must not decide legal setup or choose roles.

### 4.3 Rules / Information owners — keep

`TroubleBrewingInformation.ts`, registration owners, night-interaction owners, and later information-resolution owners determine rules-legal facts/candidates.

They may consume a snapshot-derived context where useful, but the snapshot must not become a rules engine.

### 4.4 Views — keep separate

`BotcPlayerView`, `BotcModeratorView`, and `BotcPublicView` remain privacy projections.

They are not the canonical cross-project snapshot.

A snapshot can contain secrets that ordinary clients must never receive.

### 4.5 Room/runtime state — excluded

The following are explicitly outside `TroubleBrewingGameSnapshotV1`:

- room owner / game moderator transport authority;
- player sessions / resume tokens;
- WebSocket / generation state;
- `commandId` / request retry state;
- Durable Object storage mechanics;
- room revision transport metadata;
- client synchronization state;
- vibration/audio/UI state.

These belong to Room Runtime / protocol / client capability owners.

---

## 5. Mapping rule for this repository

The first implementation must be a **pure deterministic projector**:

```text
projectTroubleBrewingGameSnapshotV1(
    BotcGameState,
    explicit snapshot/decision context if required
) -> TroubleBrewingGameSnapshotV1
```

Properties:

1. no mutation;
2. no random choice;
3. no recommendation/ranking;
4. no client/privacy projection;
5. deterministic serialization for equal semantic state;
6. unresolved semantic facts represented explicitly, not inferred from missing fields;
7. no dependency on Cloudflare/Node/WeChat runtime adapters.

The projector should live under the BotC game/domain ownership boundary, not under runtime or client code.

---

## 6. Important current semantic divergence: Drunk timing

The current online PV-1 automatic setup baseline fully creates `actualRoleId` / `shownRoleId` assignments at game start, including Drunk.

The cross-project canonical snapshot contract must **not bake in the assumption that every actual role is always committed at initial snapshot time**.

The shared V1 semantics must remain capable of expressing a setup/decision point where a legal Drunk candidate's actual role is `UNCOMMITTED`, while already-fixed roles remain `KNOWN`.

This audit does **not** expand the current playable slice into Drunk late-binding implementation.

Instead:

- current online games project their already-committed Drunk state as `KNOWN`;
- future DLB adoption can project `UNCOMMITTED` before authoritative assignment;
- the snapshot schema does not need to change merely because the online runtime later changes when commitment occurs.

This preserves the current Simulator-first route while avoiding a future schema fork.

---

## 7. PV-3B2 integration requirement

PV-3B2 remains the current gameplay NEXT, but it now has an additional architecture gate.

For Washerwoman / Librarian / Investigator / Chef / Empath information results:

```text
Rules / Information
  -> legal result/candidate domain
  -> simple rules-legal baseline choice where recommendation depth is deferred
  -> authoritative commit in BotcGameState
  -> canonical snapshot reflects KNOWN(result)
  -> PlayerView exposes only the recipient-safe private result
```

Before commit, if the ability/result is applicable but no result has been chosen, the canonical snapshot must be able to express `UNCOMMITTED`.

Poisoning/drunkenness and later misinformation selection must remain separate concepts:

- impairment source/lifetime is a canonical game fact;
- the legal information domain belongs to Rules / Information;
- recommendation chooses among allowed outcomes when policy is needed;
- Game Engine commits the accepted result;
- snapshot records the committed/uncommitted state.

PV-3B2 must not introduce a second private "information state" that cannot be projected into the shared snapshot model.

---

## 8. Implementation route

### UGSM-0 — adoption audit / route freeze ✅ COMPLETE by this document

Deliverables:

- freeze owner boundary: `BotcGameState` mutable authority vs canonical snapshot read model;
- adopt cross-project four-state fact semantics;
- exclude room/network/client state;
- make snapshot compatibility a PV-3B2 gate;
- record current Drunk-timing divergence without forcing DLB into the playable MVP.

No production semantics change.

### UGSM-1 — exact V1 contract + pure projector ✅ COMPLETE

Implemented as an independent contract/codec in `src/games/botc/TroubleBrewingGameSnapshot.ts` plus the online-state adapter in `src/games/botc/TroubleBrewingGameSnapshotProjection.ts`, against the frozen Host V1 contract at live CampBoardGameHost main `d862cf9efe5348506aba63feee6154d4e3e871ad`.

Delivered:

- exact schema identity `botc.tb.game-snapshot` / version `1` / external script ID `trouble_brewing`;
- TypeScript four-state `SnapshotField` semantics matching KNOWN / UNCOMMITTED / UNKNOWN / NOT_APPLICABLE;
- exact V1 position / seat / setup-state structure;
- pure `BotcGameState + projection context -> TroubleBrewingGameSnapshotV1` projector;
- explicit seat-order mapping rather than assuming assignment-array order is the cross-project seat identity;
- `role_reveal -> SETUP_COMMITTED`; live day/night phases -> `RUNTIME` with DAY/NIGHT + positive round;
- current alive and Poisoner state projected as canonical seat facts;
- deterministic JSON field order matching the frozen Host V1 interchange codec;
- no Room Runtime, Cloudflare, client/view, recommendation or mutation dependency.

Important compatibility decision: this online runtime currently has no authoritative `gameSeed` field and no semantically equivalent independent player-input revision owner. UGSM-1 therefore requires `gameId` / `gameSeed` / seat order as explicit projection context and represents absent revision producers as NOT_APPLICABLE. It does **not** manufacture a seed/revision or consume extra randomness merely to satisfy the interchange DTO.

Current online setup is already committed before `BotcGameState` exists, so the current projector emits SETUP_COMMITTED/RUNTIME snapshots only. The V1 type still supports SETUP_PRECOMMIT + UNCOMMITTED exactly; a future DLB intermediate owner can add that projector without changing the schema.

Validation: `typecheck` PASS; full `npm test` PASS with 137 test files / 574 tests; Web client and both WeChat product shells build/verify PASS.

### UGSM-2 — semantic-equivalence fixtures

Add canonical JSON fixtures that are semantically identical across participating projects.

Minimum useful fixtures:

1. finalized TB setup with Drunk actual-vs-shown;
2. pre-Drunk/uncommitted decision snapshot once the exact shared fixture is available;
3. runtime first-night decision boundary with a committed effect/result;
4. one historical EvidenceLab reconstruction fixture when materializer output stabilizes.

The fixture is a contract artifact, not a runtime persistence format.

### UGSM-3 — recommendation/context migration

As Recommendation work resumes:

- recommendation requests should derive game truth from the canonical snapshot or a typed projection of it;
- optional enrichment such as player skill/history/public claims remains outside the minimal canonical rules snapshot unless the shared contract explicitly adopts it;
- recommendation output remains read-only and cannot mutate canonical state.

---

## 9. Sharing strategy

Do not create a cross-repository package yet.

Current sequence:

```text
shared semantics
  -> exact schema/spec
  -> deterministic JSON fixtures
  -> per-project adapters/projectors
  -> cross-project semantic-equivalence tests
  -> only later consider generated/shared code package
```

Reason:

- Android/offline Host, EvidenceLab and online Web/WeChat runtime have different execution and persistence owners;
- sharing semantics now is high value;
- sharing runtime code now would create unnecessary coupling.

---

## 10. Acceptance criteria for UGSM-0

UGSM-0 is accepted when project authority documents make all of the following explicit:

- this repository adopts `TroubleBrewingGameSnapshotV1` as the cross-project canonical read model;
- `BotcGameState` remains the online mutable authoritative owner;
- snapshot fact states distinguish KNOWN / UNCOMMITTED / UNKNOWN / NOT_APPLICABLE;
- Room Runtime / protocol / client state is excluded;
- PV-3B2 cannot add durable information-result semantics without a snapshot mapping;
- current immediate Drunk commitment is a runtime behavior, not a schema assumption;
- no cross-repo package is introduced at this stage.

---

## 11. NEXT

```text
PV-3B1 ✅
  ->
UGSM-0 adoption audit ✅
  ->
UGSM-1 exact V1 contract + pure projector ✅
  ->
PV-3B2 first-night information resolution ← NEXT
```

UGSM-1 should stay narrow. It is a compatibility seam, not a new game engine and not a reason to delay the playable vertical slice with broad model redesign.
